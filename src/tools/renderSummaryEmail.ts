import { renderSummaryEmail } from "../email/render.js";
import type { RenderSummaryEmailInput } from "./schemas.js";
import { jsonResult, type ToolResult } from "./result.js";

export function handleRenderSummaryEmail(input: RenderSummaryEmailInput): ToolResult {
  return jsonResult(renderSummaryEmail(input));
}
