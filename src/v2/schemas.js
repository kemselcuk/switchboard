export const V2_KEY_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';

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
    description: descriptionProperty,
    enabled: { type: 'boolean' },
    rolloutPercentage: rolloutProperty,
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
