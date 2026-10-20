export type EvaluationContext = {
  targetingKey?: string;
  [attribute: string]: unknown;
};

export type EvaluationResult<T> = {
  key: string;
  value: T;
  reason: string;
  variant?: string;
};
