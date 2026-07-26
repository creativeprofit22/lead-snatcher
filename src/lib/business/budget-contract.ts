export interface BudgetEstimate {
  min: number;
  max: number;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  /** Raw 0-100 score the budget range was derived from. Used by Fit Score. */
  points: number;
}
