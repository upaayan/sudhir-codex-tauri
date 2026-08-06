import { useState } from "react";

import type {
  CommandExecutionRequestApprovalParams,
  JsonValue,
  McpServerElicitationRequestParams,
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
  if (request.method === "mcpServer/elicitation/request") {
    return <McpElicitationRequest request={request} onResolve={onResolve} />;
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

type ElicitationValue = string | boolean | string[];

interface ElicitationField {
  name: string;
  title: string;
  description: string | null;
  type: string;
  required: boolean;
  multiple: boolean;
  options: Array<{ value: string; label: string }>;
  defaultValue: ElicitationValue;
}

function McpElicitationRequest({ request, onResolve }: Props) {
  const params = request.params as McpServerElicitationRequestParams;
  const fields = elicitationFields(params.requestedSchema);
  const [values, setValues] = useState<Record<string, ElicitationValue>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.defaultValue])));
  const [validationError, setValidationError] = useState<string | null>(null);

  function accept() {
    const content: Record<string, JsonValue> = {};
    for (const field of fields) {
      const value = values[field.name] ?? field.defaultValue;
      const empty = Array.isArray(value) ? value.length === 0 : typeof value === "string" && !value.trim();
      if (field.required && empty) {
        setValidationError(`${field.title} is required.`);
        return;
      }
      if (empty && !field.required) {
        continue;
      }
      if ((field.type === "number" || field.type === "integer") && typeof value === "string") {
        const number = Number(value);
        if (!Number.isFinite(number)) {
          setValidationError(`${field.title} must be a number.`);
          return;
        }
        content[field.name] = field.type === "integer" ? Math.trunc(number) : number;
      } else {
        content[field.name] = value;
      }
    }
    setValidationError(null);
    onResolve({
      result: {
        action: "accept",
        content: params.mode === "url" ? null : content,
        _meta: null,
      },
    });
  }

  return (
    <div className="interaction-card">
      <div className="interaction-title">{request.label}</div>
      <p className="interaction-reason">Requested by {params.serverName}</p>
      {params.url ? <div className="interaction-url">{params.url}</div> : null}
      {fields.map((field) => (
        <div key={field.name} className="interaction-question">
          {field.type === "boolean" ? (
            <label className="interaction-checkbox">
              <input
                type="checkbox"
                checked={values[field.name] === true}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.checked }))
                }
              />
              <span>{field.title}</span>
            </label>
          ) : (
            <>
              <label className="interaction-question-label" htmlFor={`elicitation-${field.name}`}>
                {field.title}{field.required ? " *" : ""}
              </label>
              {field.options.length > 0 ? (
                <select
                  id={`elicitation-${field.name}`}
                  multiple={field.multiple}
                  value={field.multiple
                    ? (Array.isArray(values[field.name]) ? values[field.name] as string[] : [])
                    : (typeof values[field.name] === "string" ? values[field.name] as string : "")}
                  onChange={(event) => {
                    const value = field.multiple
                      ? Array.from(event.target.selectedOptions, (option) => option.value)
                      : event.target.value;
                    setValues((current) => ({ ...current, [field.name]: value }));
                  }}
                >
                  {!field.multiple ? <option value="">Select…</option> : null}
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`elicitation-${field.name}`}
                  type={elicitationInputType(field.type)}
                  step={field.type === "integer" ? "1" : undefined}
                  value={typeof values[field.name] === "string" ? values[field.name] as string : ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              )}
            </>
          )}
          {field.description ? <div className="interaction-description">{field.description}</div> : null}
        </div>
      ))}
      {validationError ? <div className="interaction-error">{validationError}</div> : null}
      <div className="interaction-actions">
        <button type="button" className="button primary" onClick={accept}>Allow</button>
        <button
          type="button"
          className="button"
          onClick={() => onResolve({ result: { action: "decline", content: null, _meta: null } })}
        >
          Decline
        </button>
        <button
          type="button"
          className="button danger"
          onClick={() => onResolve({ result: { action: "cancel", content: null, _meta: null } })}
        >
          Cancel turn
        </button>
      </div>
    </div>
  );
}

function elicitationFields(schemaValue: JsonValue | undefined): ElicitationField[] {
  const schema = jsonRecord(schemaValue);
  const properties = jsonRecord(schema?.properties);
  if (!properties) {
    return [];
  }
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  return Object.entries(properties).flatMap(([name, value]) => {
    const property = jsonRecord(value);
    if (!property) {
      return [];
    }
    const type = typeof property.type === "string" ? property.type : "string";
    const multiple = type === "array";
    const options = elicitationOptions(property, multiple);
    const rawDefault = property.default;
    let defaultValue: ElicitationValue = multiple ? [] : type === "boolean" ? false : "";
    if (multiple && Array.isArray(rawDefault)) {
      defaultValue = rawDefault.filter((entry): entry is string => typeof entry === "string");
    } else if (type === "boolean" && typeof rawDefault === "boolean") {
      defaultValue = rawDefault;
    } else if (["string", "number"].includes(typeof rawDefault)) {
      defaultValue = String(rawDefault);
    }
    return [{
      name,
      title: typeof property.title === "string" ? property.title : name,
      description: typeof property.description === "string" ? property.description : null,
      type,
      required: required.has(name),
      multiple,
      options,
      defaultValue,
    }];
  });
}

function elicitationOptions(
  property: Record<string, JsonValue>,
  multiple: boolean,
): Array<{ value: string; label: string }> {
  if (property.type === "openai/imagePicker" && Array.isArray(property.items)) {
    return property.items.flatMap((item) => {
      const record = jsonRecord(item);
      return record && typeof record.id === "string"
        ? [{ value: record.id, label: typeof record.title === "string" ? record.title : record.id }]
        : [];
    });
  }
  const optionOwner = multiple ? jsonRecord(property.items) : property;
  if (!optionOwner) {
    return [];
  }
  if (Array.isArray(optionOwner.enum)) {
    const names = Array.isArray(optionOwner.enumNames) ? optionOwner.enumNames : [];
    return optionOwner.enum.flatMap((value, index) => typeof value === "string"
      ? [{ value, label: typeof names[index] === "string" ? names[index] : value }]
      : []);
  }
  const titled = Array.isArray(optionOwner.oneOf)
    ? optionOwner.oneOf
    : Array.isArray(optionOwner.anyOf) ? optionOwner.anyOf : [];
  return titled.flatMap((option) => {
    const record = jsonRecord(option);
    return record && typeof record.const === "string"
      ? [{ value: record.const, label: typeof record.title === "string" ? record.title : record.const }]
      : [];
  });
}

function elicitationInputType(type: string): string {
  if (type === "number" || type === "integer") {
    return "number";
  }
  if (["email", "url", "date", "datetime-local"].includes(type)) {
    return type;
  }
  return "text";
}

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}
