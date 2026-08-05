import { useState } from "react";

import type {
  CommandExecutionRequestApprovalParams,
  PermissionsRequestApprovalParams,
  ServerRequestHandlerResult,
  ToolRequestUserInputParams,
} from "../codex-types.ts";

export interface PendingRequest {
  requestId: string | number;
  method: string;
  label: string;
  params: unknown;
}

interface Props {
  request: PendingRequest;
  onResolve: (outcome: ServerRequestHandlerResult) => void;
}

export function InteractionRequest({ request, onResolve }: Props) {
  if (request.method === "item/tool/requestUserInput") {
    return <UserInputRequest request={request} onResolve={onResolve} />;
  }
  return <ApprovalRequest request={request} onResolve={onResolve} />;
}

function ApprovalRequest({ request, onResolve }: Props) {
  const params = request.params as
    | CommandExecutionRequestApprovalParams
    | PermissionsRequestApprovalParams;
  const permissionParams = request.method === "item/permissions/requestApproval"
    ? (params as PermissionsRequestApprovalParams)
    : null;
  const isPermissions = request.method === "item/permissions/requestApproval";
  const isFileChange = request.method === "item/fileChange/requestApproval";

  return (
    <div className="interaction-card">
      <div className="interaction-title">{request.label}</div>
      {"command" in params && params.command && (
        <pre className="interaction-command">{params.command}</pre>
      )}
      {"reason" in params && params.reason && <p className="interaction-reason">{params.reason}</p>}
      <div className="interaction-actions">
        <button
          type="button"
          className="button primary"
          onClick={() =>
            onResolve(
              isPermissions
                ? { result: { permissions: permissionParams?.permissions ?? {}, scope: "session" } }
                : isFileChange
                  ? { result: { decision: "accept" } }
                  : { result: { decision: "accept" } },
            )
          }
        >
          Approve
        </button>
        <button
          type="button"
          className="button"
          onClick={() =>
            onResolve(
              isPermissions
                ? { error: { code: -32000, message: "permission declined" } }
                : { result: { decision: "decline" } },
            )
          }
        >
          Decline
        </button>
        {!isPermissions && (
          <button
            type="button"
            className="button danger"
            onClick={() => onResolve({ result: { decision: "cancel" } })}
          >
            Cancel turn
          </button>
        )}
      </div>
    </div>
  );
}

function UserInputRequest({ request, onResolve }: Props) {
  const params = request.params as ToolRequestUserInputParams;
  const [answers, setAnswers] = useState<Record<string, string>>({});

  function submit() {
    const result: Record<string, { answers: string[] }> = {};
    for (const question of params.questions) {
      const value = answers[question.id]?.trim();
      if (question.isSecret && !value) {
        return;
      }
      result[question.id] = { answers: [value ?? ""] };
    }
    onResolve({ result: { answers: result } });
  }

  return (
    <div className="interaction-card">
      <div className="interaction-title">Input requested</div>
      {params.questions.map((question) => (
        <div key={question.id} className="interaction-question">
          <label className="interaction-question-label">{question.question}</label>
          {question.options?.length ? (
            <select
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
              }
            >
              <option value="">Select…</option>
              {question.options.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={question.isSecret ? "password" : "text"}
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
              }
            />
          )}
        </div>
      ))}
      <div className="interaction-actions">
        <button type="button" className="button primary" onClick={submit}>
          Submit
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onResolve({ error: { code: -32000, message: "input declined" } })}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
