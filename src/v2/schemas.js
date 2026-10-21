export const V2_KEY_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';

export const FLAG_TYPES = Object.freeze([
  'boolean',
  'string',
  'number',
  'json',
]);

export const MAX_FLAG_STRING_LENGTH = 4096;
export const MAX_FLAG_JSON_BYTES = 8192;

const keyProperty = {
  type: 'string',
  pattern: V2_KEY_PATTERN,
};

const nameProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 80,
};

const descriptionProperty = {
  type: 'string',
  maxLength: 280,
};

const rolloutProperty = {
  type: 'number',
  minimum: 0,
  maximum: 100,
};

const flagTypeProperty = {
  type: 'string',
  enum: [...FLAG_TYPES],
};

// The value type depends on flag.type, so the domain check in
// flagValuesError owns the shape and size limits.
const flagValueProperty = {};

function flagValueError(label, type, value) {
  if (type === 'string') {
    if (typeof value !== 'string') {
      return `${label} must be a string`;
    }
    if (value.length > MAX_FLAG_STRING_LENGTH) {
      return `${label} must be at most ${MAX_FLAG_STRING_LENGTH} characters`;
    }
    return null;
  }

  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${label} must be a finite number`;
    }
    return null;
  }

  if (type === 'json') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return `${label} must be a plain JSON object`;
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_FLAG_JSON_BYTES) {
      return `${label} must serialize to at most ${MAX_FLAG_JSON_BYTES} bytes`;
    }
    return null;
  }

  return null;
}

export function flagValuesError(type, onValue, offValue) {
  if (type === 'boolean') {
    if (onValue !== undefined || offValue !== undefined) {
      return 'onValue and offValue are not allowed for boolean flags';
    }

    return null;
  }

  if (onValue === undefined || offValue === undefined) {
    return `onValue and offValue are required for ${type} flags`;
  }

  return flagValueError('onValue', type, onValue)
    ?? flagValueError('offValue', type, offValue);
}

export const projectBody = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name'],
  properties: {
    key: keyProperty,
    name: nameProperty,
  },
};

export const environmentBody = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name'],
  properties: {
    key: keyProperty,
    name: nameProperty,
  },
};

export const createFlagBody = {
  type: 'object',
  additionalProperties: false,
  required: ['key'],
  properties: {
    key: keyProperty,
    type: flagTypeProperty,
    description: descriptionProperty,
    enabled: { type: 'boolean' },
    rolloutPercentage: rolloutProperty,
    onValue: flagValueProperty,
    offValue: flagValueProperty,
  },
};

export const updateFlagBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    description: descriptionProperty,
    enabled: { type: 'boolean' },
    rolloutPercentage: rolloutProperty,
    onValue: flagValueProperty,
    offValue: flagValueProperty,
  },
};

export const createApiKeyBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: nameProperty,
    type: { type: 'string', enum: ['server'] },
  },
};

export const ofrepEvaluationBody = {
  type: 'object',
  additionalProperties: false,
  required: ['context'],
  properties: {
    context: {
      type: 'object',
      additionalProperties: true,
      properties: {
        targetingKey: { type: 'string' },
      },
    },
  },
};

export const projectParams = {
  type: 'object',
  required: ['project'],
  properties: {
    project: keyProperty,
  },
};

export const environmentParams = {
  type: 'object',
  required: ['project', 'env'],
  properties: {
    project: keyProperty,
    env: keyProperty,
  },
};

export const projectFlagParams = {
  type: 'object',
  required: ['project', 'key'],
  properties: {
    project: keyProperty,
    key: keyProperty,
  },
};

export const flagParams = {
  type: 'object',
  required: ['project', 'env', 'key'],
  properties: {
    project: keyProperty,
    env: keyProperty,
    key: keyProperty,
  },
};

export const ofrepFlagParams = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 1 },
  },
};

export const apiKeyParams = {
  type: 'object',
  required: ['project', 'env', 'id'],
  properties: {
    project: keyProperty,
    env: keyProperty,
    id: { type: 'string', minLength: 1 },
  },
};
