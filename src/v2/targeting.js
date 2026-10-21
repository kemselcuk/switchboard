import { V2_KEY_PATTERN } from './constants.js';

export const MAX_SEGMENT_CONDITIONS = 20;
export const MAX_FLAG_RULES = 50;
export const MAX_ATTRIBUTE_LENGTH = 64;
export const MAX_CONDITION_STRING_LENGTH = 256;
export const MAX_RULES_BODY_BYTES = 2 * 1024 * 1024;
export const CONDITION_OPERATORS = Object.freeze(['eq']);
export const RULE_ACTIONS = Object.freeze(['on', 'off']);

const KEY_PATTERN = new RegExp(V2_KEY_PATTERN);
const CONDITION_KEYS = new Set(['attribute', 'operator', 'value']);
const RULE_KEYS = new Set(['segmentKey', 'conditions', 'action']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function conditionError(condition, label) {
  if (!isPlainObject(condition)) {
    return `${label} must be an object`;
  }

  if (!hasOnlyKeys(condition, CONDITION_KEYS)) {
    return `${label} contains an unsupported field`;
  }

  const { attribute, operator, value } = condition;

  if (
    typeof attribute !== 'string'
    || attribute.length < 1
    || attribute.length > MAX_ATTRIBUTE_LENGTH
  ) {
    return `${label}.attribute must be a string of 1..${MAX_ATTRIBUTE_LENGTH} characters`;
  }

  if (!CONDITION_OPERATORS.includes(operator)) {
    return `${label}.operator must be 'eq'`;
  }

  if (typeof value === 'string') {
    if (value.length > MAX_CONDITION_STRING_LENGTH) {
      return `${label}.value must be at most ${MAX_CONDITION_STRING_LENGTH} characters`;
    }
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : `${label}.value must be a finite number`;
  }

  if (typeof value === 'boolean') {
    return null;
  }

  return `${label}.value must be a string, number, or boolean`;
}

export function conditionsError(conditions, label = 'conditions') {
  if (!Array.isArray(conditions)) {
    return `${label} must be an array`;
  }

  if (conditions.length > MAX_SEGMENT_CONDITIONS) {
    return `${label} must contain at most ${MAX_SEGMENT_CONDITIONS} conditions`;
  }

  for (let index = 0; index < conditions.length; index += 1) {
    const message = conditionError(conditions[index], `${label}[${index}]`);

    if (message) {
      return message;
    }
  }

  return null;
}

export function ruleError(rule, label = 'rule') {
  if (!isPlainObject(rule)) {
    return `${label} must be an object`;
  }

  if (!hasOnlyKeys(rule, RULE_KEYS)) {
    return `${label} contains an unsupported field`;
  }

  const hasSegment = rule.segmentKey !== undefined;
  const hasConditions = rule.conditions !== undefined;

  if (hasSegment === hasConditions) {
    return `${label} must contain exactly one of segmentKey or conditions`;
  }

  if (hasSegment) {
    if (
      typeof rule.segmentKey !== 'string'
      || !KEY_PATTERN.test(rule.segmentKey)
    ) {
      return `${label}.segmentKey must match ${V2_KEY_PATTERN}`;
    }
  } else {
    const message = conditionsError(rule.conditions, `${label}.conditions`);

    if (message) {
      return message;
    }
  }

  if (!RULE_ACTIONS.includes(rule.action)) {
    return `${label}.action must be 'on' or 'off'`;
  }

  return null;
}

export function rulesError(rules, label = 'rules') {
  if (!Array.isArray(rules)) {
    return `${label} must be an array`;
  }

  if (rules.length > MAX_FLAG_RULES) {
    return `${label} must contain at most ${MAX_FLAG_RULES} rules`;
  }

  for (let index = 0; index < rules.length; index += 1) {
    const message = ruleError(rules[index], `${label}[${index}]`);

    if (message) {
      return message;
    }
  }

  return null;
}

export function matchesConditions(conditions, context) {
  if (!isPlainObject(context)) {
    return false;
  }

  return conditions.every((condition) => Object.hasOwn(
    context,
    condition.attribute,
  ) && context[condition.attribute] === condition.value);
}

function conditionsForRule(rule, segments) {
  if (Array.isArray(rule.conditions)) {
    return rule.conditions;
  }

  if (typeof rule.segmentKey !== 'string') {
    return null;
  }

  const segment = segments.find((entry) => entry.key === rule.segmentKey);

  return Array.isArray(segment?.conditions) ? segment.conditions : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

export function contextFingerprint(context) {
  return JSON.stringify(canonicalize(context ?? {}));
}

export function firstMatchingRule(rules, segments, context) {
  for (const rule of rules) {
    const conditions = conditionsForRule(rule, segments);

    if (
      Array.isArray(conditions)
      && matchesConditions(conditions, context)
    ) {
      return rule;
    }
  }

  return null;
}
