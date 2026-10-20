export const FLAG_KEY_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';

export const createFlagBody = {
  type: 'object',
  additionalProperties: false,
  required: ['key'],
  properties: {
    key: {
      type: 'string',
      pattern: FLAG_KEY_PATTERN,
    },
    description: {
      type: 'string',
      maxLength: 280,
    },
    enabled: {
      type: 'boolean',
    },
    rolloutPercentage: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
    },
  },
};

export const updateFlagBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    description: {
      type: 'string',
      maxLength: 280,
    },
    enabled: {
      type: 'boolean',
    },
    rolloutPercentage: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
    },
  },
};

export const evaluateBody = {
  type: 'object',
  additionalProperties: false,
  required: ['flagKey', 'userId'],
  properties: {
    flagKey: {
      type: 'string',
      pattern: FLAG_KEY_PATTERN,
    },
    userId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '\\S',
    },
  },
};

export const flagKeyParams = {
  type: 'object',
  required: ['key'],
  properties: {
    key: {
      type: 'string',
      minLength: 1,
    },
  },
};
