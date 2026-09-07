/**
 * Grade badge, as an SVG served from the Worker.
 *
 * The badge carries the probe date and the model, not just the letter. A grade
 * with no model on it is a claim nobody can check, and this badge is the thing
 * most likely to be screenshotted and pasted somewhere without its report.
 *
 * Hand-rolled SVG: no dependency, no build step, and it renders in a README.
 */

import type { Band } from '../grade/types.js';

export const BAND_COLORS: Record<Band, string> = {
  A: '#2f855a',
  B: '#2b6cb0',
  C: '#b7791f',
  F: '#c53030',
};

export interface BadgeInput {
  band: Band;
  score: number;
  model: string;
  graded_at: string;
  hard_fail?: boolean;
}

/** Rough advance width for 11px DejaVu Sans, good enough to size a badge. */
function textWidth(s: string, size = 11): number {
  return Math.ceil(s.length * size * 0.6);
}

export function buildBadge(i: BadgeInput): string {
  const label = 'MCP grade';
  const value = i.hard_fail ? i.band + ' (hard fail)' : i.band + ' ' + i.score;
  const sub = shortModel(i.model) + ' - ' + i.graded_at.slice(0, 10);

  const padding = 8;
  const labelW = textWidth(label) + padding * 2;
  const valueW = textWidth(value) + padding * 2;
  const subW = textWidth(sub, 9) + padding * 2;
  const topW = labelW + valueW;
  const width = Math.max(topW, subW);
  const height = 38;
  const color = BAND_COLORS[i.band];

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"',
    '     role="img" aria-label="' + esc(label + ': ' + value + ', ' + sub) + '">',
    '  <title>' + esc(label + ': ' + value + ' (' + sub + ')') + '</title>',
    '  <rect width="' + width + '" height="' + height + '" rx="4" fill="#f7fafc"/>',
    '  <rect width="' + labelW + '" height="20" rx="4" fill="#4a5568"/>',
    '  <rect x="' + (labelW - 4) + '" width="8" height="20" fill="#4a5568"/>',
    '  <rect x="' + labelW + '" width="' + valueW + '" height="20" rx="4" fill="' + color + '"/>',
    '  <rect x="' + labelW + '" width="8" height="20" fill="' + color + '"/>',
    '  <g font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">',
    '    <text x="' + labelW / 2 + '" y="14" fill="#fff" text-anchor="middle">' + esc(label) + '</text>',
    '    <text x="' + (labelW + valueW / 2) + '" y="14" fill="#fff" text-anchor="middle" font-weight="bold">' + esc(value) + '</text>',
    '  </g>',
    '  <text x="' + width / 2 + '" y="32" fill="#4a5568" text-anchor="middle"',
    '        font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="9">' + esc(sub) + '</text>',
    '</svg>',
  ].join('\n');
}

/** A badge that says the server has never been graded. Never blank, never a lie. */
export function buildUnknownBadge(): string {
  const label = 'MCP grade';
  const value = 'ungraded';
  const labelW = textWidth(label) + 16;
  const valueW = textWidth(value) + 16;
  const width = labelW + valueW;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="20"',
    '     role="img" aria-label="MCP grade: ungraded">',
    '  <title>MCP grade: ungraded</title>',
    '  <rect width="' + labelW + '" height="20" rx="4" fill="#4a5568"/>',
    '  <rect x="' + labelW + '" width="' + valueW + '" height="20" rx="4" fill="#718096"/>',
    '  <g font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" fill="#fff">',
    '    <text x="' + labelW / 2 + '" y="14" text-anchor="middle">' + label + '</text>',
    '    <text x="' + (labelW + valueW / 2) + '" y="14" text-anchor="middle">' + value + '</text>',
    '  </g>',
    '</svg>',
  ].join('\n');
}

function shortModel(m: string): string {
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
