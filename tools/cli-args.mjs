/**
 * Shared CLI flag parser built on Node's `node:util` `parseArgs`.
 *
 * Pre-normalizes negative numeric values passed as separate tokens after string flags
 * (e.g. `--lon -118.3698`) and inline `--flag=true|false|1|0` values on boolean flags,
 * and maps `parseArgs` errors to consistent CLI messages.
 */

import { parseArgs } from 'node:util';

const NEGATIVE_NUMBER_RE = /^-(?:\d|\.\d)/;
const BOOLEAN_TRUE = new Set(['true', '1']);
const BOOLEAN_FALSE = new Set(['false', '0']);
const FALSE_FLAG_PREFIX = '__cli_false_';

function mapParseArgsError(err) {
  if (!(err instanceof Error)) {
    return new Error(String(err));
  }
  const code = /** @type {{ code?: string }} */ (err).code;
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const match = /Unknown option '([^']+)'/.exec(err.message);
    if (match) {
      return new Error(`Unknown flag '${match[1]}'`);
    }
  }
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
    const match = /Unexpected argument '([^']+)'/.exec(err.message);
    if (match) {
      return new Error(`Unexpected positional argument '${match[1]}'`);
    }
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const match = /Option '(?:-[^,]+,\s*)?(--?[^' ]+)/.exec(err.message);
    if (
      match &&
      (err.message.includes('argument missing') || err.message.includes('argument is ambiguous'))
    ) {
      return new Error(`Missing value for flag '${match[1]}'`);
    }
  }
  return err;
}

/**
 * Parses CLI option flags using `node:util` `parseArgs`.
 *
 * @param {readonly string[]} argv
 * @param {Record<string, { type: 'string' | 'boolean', short?: string, multiple?: boolean }>} options
 * @param {{ allowPositionals?: boolean }} [config]
 */
export function parseCliFlags(argv, options, config = {}) {
  const allOptions = {
    help: { type: 'boolean', short: 'h' },
    ...options,
  };
  /** @type {Record<string, { type: 'boolean' }>} */
  const extraFalseOptions = {};

  let afterTerminator = false;
  let skipNext = false;
  let pendingStringFlag = false;

  const normalized = argv.reduce((acc, token, idx) => {
    if (skipNext) {
      skipNext = false;
      return acc;
    }
    if (afterTerminator) {
      acc.push(token);
      return acc;
    }
    if (token === '--') {
      afterTerminator = true;
      pendingStringFlag = false;
      acc.push(token);
      return acc;
    }
    if (pendingStringFlag) {
      pendingStringFlag = false;
      acc.push(token);
      return acc;
    }
    if (token.startsWith('--')) {
      if (token.startsWith(`--${FALSE_FLAG_PREFIX}`)) {
        throw new Error(`Unknown flag '${token.split('=')[0]}'`);
      }
      const eqIdx = token.indexOf('=');
      if (eqIdx === -1) {
        const name = token.slice(2);
        if (allOptions[name]?.type === 'string') {
          const next = argv[idx + 1];
          if (next !== undefined && NEGATIVE_NUMBER_RE.test(next)) {
            acc.push(`${token}=${next}`);
            skipNext = true;
            return acc;
          }
          pendingStringFlag = true;
        }
        acc.push(token);
        return acc;
      }

      const name = token.slice(2, eqIdx);
      if (allOptions[name]?.type === 'boolean') {
        const rawVal = token.slice(eqIdx + 1).toLowerCase();
        if (BOOLEAN_TRUE.has(rawVal)) {
          acc.push(`--${name}`);
          return acc;
        }
        if (BOOLEAN_FALSE.has(rawVal)) {
          const falseName = `${FALSE_FLAG_PREFIX}${name}`;
          extraFalseOptions[falseName] = { type: 'boolean' };
          acc.push(`--${falseName}`);
          return acc;
        }
        throw new Error(`Invalid boolean value for '--${name}': '${rawVal}'`);
      }
    }
    acc.push(token);
    return acc;
  }, /** @type {string[]} */ ([]));

  let parsed;
  try {
    parsed = parseArgs({
      args: normalized,
      options: { ...allOptions, ...extraFalseOptions },
      strict: true,
      allowPositionals: config.allowPositionals ?? false,
      tokens: true,
    });
  } catch (err) {
    throw mapParseArgsError(err);
  }

  /** @type {Record<string, any>} */
  const values = { ...parsed.values };
  const hasSyntheticFalse = Object.keys(extraFalseOptions).length > 0;
  if (hasSyntheticFalse) {
    for (const falseKey of Object.keys(extraFalseOptions)) {
      delete values[falseKey];
    }
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (token.name.startsWith(FALSE_FLAG_PREFIX)) {
        values[token.name.slice(FALSE_FLAG_PREFIX.length)] = false;
      } else if (allOptions[token.name]?.type === 'boolean') {
        values[token.name] = true;
      }
    }
  }

  const tokens = hasSyntheticFalse
    ? parsed.tokens.map((token) =>
        token.kind === 'option' && token.name.startsWith(FALSE_FLAG_PREFIX)
          ? { ...token, name: token.name.slice(FALSE_FLAG_PREFIX.length), value: false }
          : token
      )
    : parsed.tokens;

  return { values, positionals: parsed.positionals, tokens };
}
