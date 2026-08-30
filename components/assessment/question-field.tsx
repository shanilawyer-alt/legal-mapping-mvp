"use client";

import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import type { AnswerValue } from "@/domain/branching/evaluate";

interface QuestionFieldProps {
  item: QuestionnaireItem;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  onCommit?: () => void;
}

const YES_NO_OPTIONS = ["כן", "לא"];
const YES_NO_UNKNOWN_OPTIONS = ["כן", "לא", "לא יודעת"];

export function QuestionField({ item, value, onChange, onCommit }: QuestionFieldProps) {
  switch (item.answerType) {
    case "short_text":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          className={textInputClass}
        />
      );

    case "number":
    case "hours":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            onBlur={onCommit}
            className={`${textInputClass} max-w-32`}
          />
          {item.answerType === "hours" ? <span className="text-sm text-slate-500">שעות</span> : null}
        </div>
      );

    case "yes_no":
      return (
        <RadioGroup
          name={item.id}
          options={YES_NO_OPTIONS}
          value={value}
          onChange={(v) => {
            onChange(v);
            onCommit?.();
          }}
        />
      );

    case "yes_no_unknown":
      return (
        <RadioGroup
          name={item.id}
          options={YES_NO_UNKNOWN_OPTIONS}
          value={value}
          onChange={(v) => {
            onChange(v);
            onCommit?.();
          }}
        />
      );

    case "single_choice":
      return (
        <RadioGroup
          name={item.id}
          options={item.options ?? []}
          value={value}
          onChange={(v) => {
            onChange(v);
            onCommit?.();
          }}
        />
      );

    case "multi_choice": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <CheckboxGroup
          name={item.id}
          options={item.options ?? []}
          selected={selected}
          onChange={(next) => {
            onChange(next);
            onCommit?.();
          }}
        />
      );
    }
  }
}

const textInputClass =
  "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

function RadioGroup({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly string[];
  value: AnswerValue;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => (
        <label
          key={option}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white"
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="sr-only"
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function CheckboxGroup({
  name,
  options,
  selected,
  onChange,
}: {
  name: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => {
        const checked = selected.includes(option);
        return (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white"
          >
            <input
              type="checkbox"
              name={name}
              value={option}
              checked={checked}
              onChange={() => {
                onChange(
                  checked ? selected.filter((v) => v !== option) : [...selected, option],
                );
              }}
              className="sr-only"
            />
            {option}
          </label>
        );
      })}
    </div>
  );
}
