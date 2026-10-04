export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export type TypeSafeQuestion = NoulQuestion | ChoiceQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export type TypeSafeAnswer = NoulAnswer | ChoiceAnswer;

export interface SystemOneRequest {
  state: unknown;
  model?: string;
  questions: Record<string, TypeSafeQuestion>;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}
