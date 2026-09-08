/**
 * A strict YAML-subset loader for task files.
 *
 * `doorman/package.json` states zero runtime dependencies as a REQUIREMENT, not
 * an achievement: this half is the giveaway, and every dependency is one more
 * thing that can fail to install on somebody else's machine. So there is no
 * yaml package here.
 *
 * The danger with a hand-rolled parser is not that it fails. It is that it
 * SILENTLY MIS-PARSES, and a task file that means something slightly different
 * from what it reads like would corrupt an eval while every number still looked
 * plausible. So this parser refuses everything it does not fully understand,
 * with the line number and the reason. There is no permissive fallback and no
 * best-effort branch.
 *
 * The supported subset, in full:
 *
 *   key: scalar            strings, integers, true/false, null
 *   key: "quoted scalar"   single or double quotes, no escapes beyond \" and \\
 *   key:                   followed by an indented block map, or
 *     - list item          a list of scalars, or
 *     - key: value         a list of single-level maps
 *   # comment              whole-line only
 *   |                      literal block scalar, for prompts
 *
 * Deliberately NOT supported, and rejected rather than approximated: anchors,
 * aliases, tags, flow collections, multi-document streams, folded scalars,
 * nested lists, and any indentation that is not a multiple of two spaces.
 */

const RESERVED = new Set(['<<', '!', '&', '*', '%']);

export class TaskParseError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`);
    this.name = 'TaskParseError';
    this.line = line;
  }
}

/** Scalars are typed narrowly. An unquoted value that looks numeric IS numeric. */
function scalar(raw, lineNo) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;

  const q = v[0];
  if (q === '"' || q === "'") {
    if (v.length < 2 || v[v.length - 1] !== q) {
      throw new TaskParseError(lineNo, 'unterminated quoted string');
    }
    const inner = v.slice(1, -1);
    if (q === '"') {
      if (/\\(?!["\\])/.test(inner)) {
        throw new TaskParseError(lineNo, 'only \\" and \\\\ escapes are supported');
      }
      return inner.replace(/\\(["\\])/g, '$1');
    }
    return inner;
  }

  if (RESERVED.has(v[0])) {
    throw new TaskParseError(lineNo, `YAML feature "${v[0]}" is not supported here`);
  }
  if (v.includes(': ') || v.endsWith(':')) {
    throw new TaskParseError(lineNo, 'unquoted colon in a value: quote it');
  }
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  return v;
}

/** Split into meaningful lines, keeping original numbers for error messages. */
function lines(src) {
  return src.replace(/\r\n/g, '\n').split('\n').map((text, i) => ({ text, no: i + 1 }));
}

function indentOf(text, lineNo) {
  const m = text.match(/^( *)/);
  const n = m[1].length;
  if (text.includes('\t')) throw new TaskParseError(lineNo, 'tabs are not valid YAML indentation');
  if (n % 2 !== 0) throw new TaskParseError(lineNo, `indent of ${n} is not a multiple of two`);
  return n;
}

/**
 * Parse a block starting at `i` with exactly `indent` leading spaces.
 * Returns [value, nextIndex].
 */
function parseBlock(all, i, indent) {
  // A list?
  const first = all[i];
  if (first && indentOf(first.text, first.no) === indent && /^ *- /.test(first.text)) {
    const out = [];
    while (i < all.length) {
      const l = all[i];
      if (l.text.trim() === '' || l.text.trim().startsWith('#')) { i++; continue; }
      const ind = indentOf(l.text, l.no);
      if (ind < indent || !/^ *- /.test(l.text)) break;
      if (ind > indent) throw new TaskParseError(l.no, 'over-indented list item');
      const body = l.text.slice(ind + 2);
      if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(body)) {
        // A list of single-level maps: `- key: value`, continued by deeper keys.
        const map = {};
        const [k, ...rest] = body.split(':');
        map[k.trim()] = scalar(rest.join(':'), l.no);
        i++;
        while (i < all.length) {
          const n = all[i];
          if (n.text.trim() === '' || n.text.trim().startsWith('#')) { i++; continue; }
          const nInd = indentOf(n.text, n.no);
          if (nInd !== indent + 2 || /^ *- /.test(n.text)) break;
          const mm = n.text.trim().match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
          if (!mm) throw new TaskParseError(n.no, 'expected key: value inside a list item');
          map[mm[1]] = scalar(mm[2], n.no);
          i++;
        }
        out.push(map);
      } else {
        out.push(scalar(body, l.no));
        i++;
      }
    }
    return [out, i];
  }

  // Otherwise a map.
  const out = {};
  let sawKey = false;
  while (i < all.length) {
    const l = all[i];
    if (l.text.trim() === '' || l.text.trim().startsWith('#')) { i++; continue; }
    const ind = indentOf(l.text, l.no);
    if (ind < indent) break;
    if (ind > indent) throw new TaskParseError(l.no, 'unexpected indentation');
    if (/^ *- /.test(l.text)) break;

    const m = l.text.trim().match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!m) throw new TaskParseError(l.no, `not a supported key: ${l.text.trim().slice(0, 40)}`);
    const key = m[1];
    const rest = m[2].trim();
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new TaskParseError(l.no, `duplicate key "${key}"`);
    }
    sawKey = true;

    if (rest === '|') {
      // Literal block scalar. Everything more-indented, verbatim, dedented.
      i++;
      const buf = [];
      let blockIndent = null;
      while (i < all.length) {
        const b = all[i];
        if (b.text.trim() === '') { buf.push(''); i++; continue; }
        const bInd = indentOf(b.text, b.no);
        if (bInd <= ind) break;
        if (blockIndent === null) blockIndent = bInd;
        if (bInd < blockIndent) break;
        buf.push(b.text.slice(blockIndent));
        i++;
      }
      while (buf.length && buf[buf.length - 1] === '') buf.pop();
      out[key] = buf.join('\n');
      continue;
    }

    if (rest === '') {
      i++;
      const [val, next] = parseBlock(all, i, ind + 2);
      // An empty nested block is an error, not an empty object: it is almost
      // always a truncated file rather than an intentional blank.
      if ((Array.isArray(val) && val.length === 0) || (!Array.isArray(val) && Object.keys(val).length === 0)) {
        throw new TaskParseError(l.no, `key "${key}" opens a block and nothing follows it`);
      }
      out[key] = val;
      i = next;
      continue;
    }

    out[key] = scalar(rest, l.no);
    i++;
  }
  if (!sawKey && i < all.length) throw new TaskParseError(all[i].no, 'expected a mapping');
  return [out, i];
}

/** Parse the supported subset, or throw with a line number. Never guesses. */
export function parseTaskYaml(src) {
  const all = lines(src);
  if (all.some((l) => l.text.trim() === '---' || l.text.trim() === '...')) {
    throw new TaskParseError(
      all.find((l) => l.text.trim() === '---' || l.text.trim() === '...').no,
      'document markers are not supported: one task per file, no front matter',
    );
  }
  let i = 0;
  while (i < all.length && (all[i].text.trim() === '' || all[i].text.trim().startsWith('#'))) i++;
  const [val] = parseBlock(all, i, 0);
  return val;
}

/**
 * The fields a task must carry for an eval to mean anything.
 *
 * `success` is required and must be checkable without a model: an eval whose
 * pass condition is itself a judgement call cannot produce a comparable number
 * across arms, which is the entire point of running two.
 */
export const REQUIRED = ['id', 'title', 'category', 'prompt', 'success'];

export function validateTask(task, where = 'task') {
  const problems = [];
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    return [`${where}: the file must be a mapping at the top level`];
  }
  for (const k of REQUIRED) {
    if (!(k in task)) problems.push(`${where}: missing required key "${k}"`);
  }
  if (typeof task.prompt === 'string' && task.prompt.trim().length < 20) {
    problems.push(`${where}: prompt is too short to be a real task`);
  }
  if ('runs' in task && (!Number.isInteger(task.runs) || task.runs < 1 || task.runs > 20)) {
    problems.push(`${where}: runs must be an integer between 1 and 20`);
  }
  const s = task.success;
  if (s !== undefined) {
    if (typeof s !== 'object' || Array.isArray(s)) {
      problems.push(`${where}: success must be a mapping of checkable conditions`);
    } else if (!('file_exists' in s) && !('contains' in s) && !('sections' in s)) {
      problems.push(
        `${where}: success needs at least one machine-checkable condition ` +
        `(file_exists, contains, or sections). A model-judged pass cannot be compared across arms.`,
      );
    }
  }
  return problems;
}
