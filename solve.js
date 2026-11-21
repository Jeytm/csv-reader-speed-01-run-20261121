// A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns, for one case's input {text, header}, exactly the answer the
// reference returns: {columns, rows, errors}. The reading policy is the
// reference's own, re-implemented from its specification:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote, and each CRLF or lone CR inside it is
//     read as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character, and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row
//     or long_row when it ends: line the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes, and row its record's
//     index in rows, null for the header.
//
// Where the reference reads one character at a time and builds every field
// up a character at a time, this reader jumps from delimiter to delimiter
// with the engine's own regex search, and takes a field's text as one slice.
// A lone CR or a quote that never closes is the rare case, so it is handled
// on a slow path while the common case never leaves the scanner. The
// unquoted-field reader writes its result into shared slots instead of
// returning a fresh object per field, so the hot path allocates nothing but
// the field strings themselves. Pure: no clock, no randomness, no locale,
// nothing kept from one call to the next.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** The first of a comma, a CR or an LF, searched from a position. */
const DELIM = /[,\r\n]/g;

/** The first of a quote, a CR or an LF, searched from a position: the
 * record fast path's probe. */
const FAST = /["\r\n]/g;

/** The line breaks inside a quoted field, for counting and normalising. */
const BREAKS = /\r\n?|\n/g;

/** Any CR or LF at all (a stateless test, so no lastIndex state). */
const HAS_NL = /[\r\n]/;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors are charged to these, not to the line
  // or record the reader happens to be on when it meets them.
  let recordLine = 1;
  let recordRow = null;

  // How the field now being read ended (COMMA, BREAK or END).
  let ended = END;

  // The unquoted field now being read: its text, and how many characters of
  // it were kept (a dropped stray CR is not kept). Written by readUnquoted
  // into these slots so the hot path returns no object per field.
  let uValue = '';
  let uAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr).
  function readUnquoted(value) {
    uAdded = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        if (pos < n) {
          value += text.slice(pos);
          uAdded += n - pos;
        }
        pos = n;
        ended = END;
        uValue = value;
        return;
      }
      const j = m.index;
      const c = m[0];
      if (c === ',') {
        if (j > pos) {
          value += text.slice(pos, j);
          uAdded += j - pos;
        }
        pos = j + 1;
        ended = COMMA;
        uValue = value;
        return;
      }
      if (c === '\n') {
        if (j > pos) {
          value += text.slice(pos, j);
          uAdded += j - pos;
        }
        pos = j + 1;
        line += 1;
        ended = BREAK;
        uValue = value;
        return;
      }
      // c === '\r'
      if (text.charCodeAt(j + 1) === 10) {
        if (j > pos) {
          value += text.slice(pos, j);
          uAdded += j - pos;
        }
        pos = j + 2;
        line += 1;
        ended = BREAK;
        uValue = value;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (j > pos) {
        value += text.slice(pos, j);
        uAdded += j - pos;
      }
      pos = j + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let quoted = false;
    // Fast path: a record whose first line holds no quote and no stray CR
    // is one line of unquoted fields. The probe finds the first quote, CR
    // or LF; a quote before the line break, or a CR that is not the CRLF
    // ending, sends the record to the slow path instead.
    FAST.lastIndex = pos;
    const fm = FAST.exec(text);
    if (fm === null) {
      fields = text.slice(pos).split(',');
      pos = n;
    } else if (fm[0] === '\n') {
      fields = text.slice(pos, fm.index).split(',');
      pos = fm.index + 1;
      line += 1;
    } else if (fm[0] === '\r' && text.charCodeAt(fm.index + 1) === 10) {
      fields = text.slice(pos, fm.index).split(',');
      pos = fm.index + 2;
      line += 1;
    }
    if (fields === null) {
      fields = [];
      do {
      if (text.charCodeAt(pos) === 34) {
        // A quoted field: find its closing quote, the next quote that is
        // not doubled.
        quoted = true;
        const open = pos;
        const openLine = line;
        let search = pos + 1;
        let escaped = false;
        let close = -1;
        for (;;) {
          const q = text.indexOf('"', search);
          if (q < 0) break;
          if (text.charCodeAt(q + 1) === 34) {
            escaped = true;
            search = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close < 0) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted. The line is put back
          // to where the field opened.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          readUnquoted('"');
          fields.push(uValue);
          continue;
        }
        // The field's content, between the quotes.
        let value = text.slice(open + 1, close);
        if (escaped) value = value.replaceAll('""', '"');
        if (HAS_NL.test(value)) {
          const breaks = value.match(BREAKS);
          line += breaks.length;
          value = value.replace(/\r\n?/g, '\n');
        }
        pos = close + 1;
        if (pos >= n) {
          fields.push(value);
          ended = END;
          break;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fields.push(value);
          ended = COMMA;
        } else if (c === 10) {
          pos += 1;
          line += 1;
          fields.push(value);
          ended = BREAK;
        } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fields.push(value);
          ended = BREAK;
        } else {
          // What follows the closing quote is appended as it stands, up
          // to the next comma or line break.
          readUnquoted(value);
          if (uAdded > 0) {
            errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
          fields.push(uValue);
        }
      } else {
        quoted = false;
        readUnquoted('');
        fields.push(uValue);
      }
    } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
