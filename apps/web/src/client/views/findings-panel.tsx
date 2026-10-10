'use client';

import type { KeyboardEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { AlertTriangleIcon, CircleAlertIcon, InfoIcon } from 'lucide-react';
import type { Severity } from '@make-your-case/domain';
import { cn } from '../../lib/utils';
import type { FindingsViewModel } from '../viewmodels/findings-view-model';

const SEVERITY_ICON: Record<Severity, typeof InfoIcon> = {
  critical: AlertTriangleIcon,
  warning: CircleAlertIcon,
  info: InfoIcon,
};

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-severity-critical',
  warning: 'text-severity-warning',
  info: 'text-severity-info',
};

const optionId = (index: number): string => `finding-option-${String(index)}`;

/**
 * The findings list (AGENTS.md section 9.2): one keyboard stop, arrow keys to
 * move, Enter to focus the finding's elements across every panel. Explanations
 * come from the analyzers, which phrase them as observations (section 1).
 */
export const FindingsPanel = observer(function FindingsPanel({
  findings,
}: {
  findings: FindingsViewModel;
}) {
  if (findings.count === 0) {
    return <p className="text-sm text-muted-foreground">The analysis made no observations.</p>;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const handled: Record<string, () => void> = {
      ArrowDown: () => {
        findings.moveNext();
      },
      ArrowUp: () => {
        findings.movePrevious();
      },
      Home: () => {
        findings.moveFirst();
      },
      End: () => {
        findings.moveLast();
      },
      Enter: () => {
        findings.focusActive();
      },
      ' ': () => {
        findings.focusActive();
      },
    };
    const action = handled[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
    const option = document.getElementById(optionId(findings.activeIndex));
    // `scrollIntoView` is missing in some test DOMs.
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' });
  };

  let position = 0;
  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label="Findings"
      aria-activedescendant={optionId(findings.activeIndex)}
      onKeyDown={onKeyDown}
      className="group/findings flex flex-col gap-4 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      {findings.groups.map((group) => {
        const Icon = SEVERITY_ICON[group.severity];
        return (
          <div key={group.severity} role="group" aria-labelledby={`findings-${group.severity}`}>
            <h3
              id={`findings-${group.severity}`}
              className={cn(
                'mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase',
                SEVERITY_TEXT[group.severity],
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {group.label} ({group.items.length})
            </h3>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item) => {
                const index = position;
                position += 1;
                const active = index === findings.activeIndex;
                const selected = findings.selectedId === item.finding.id;
                return (
                  <li
                    key={item.finding.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      findings.focus(item.finding.id);
                    }}
                    className={cn(
                      'cursor-pointer rounded-md border p-2 text-sm hover:bg-muted',
                      selected && 'border-foreground bg-muted',
                      // The keyboard position, visible only while the list has focus.
                      active &&
                        'group-focus-visible/findings:outline-2 group-focus-visible/findings:outline-ring',
                    )}
                  >
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-0.5 text-muted-foreground">{item.finding.explanation}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
});
