// panel/src/components/setup-tab.tsx

import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Eye,
  EyeOff,
  Folder,
  Save01,
  Settings01,
  XCircle
} from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Toggle } from '@/components/base/toggle/toggle';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Select, type SelectOption } from '@/components/base/select/select';
import { cx } from '@/utils/cx';
import {
  SETUP_SECTIONS,
  TEXT_FIELD_BY_KEY,
  TOGGLE_BY_KEY
} from '../constants';
import { Icon } from './icon';
import { BoardValidationAlert } from './board-validation-alert';
import type { ValidationResult } from '../types';

export function SetupTab({
  config,
  setConfig,
  validationMap,
  revealedFields,
  toggleFieldVisibility,
  busy,
  pickClaudeWorkdir,
  saveDisabled,
  hasBlockingErrors,
  allFieldsValidated,
  changedKeys,
  onSaveClick,
  apiBaseUrl
}: {
  config: Record<string, any>;
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  validationMap: Record<string, ValidationResult>;
  revealedFields: Record<string, boolean>;
  toggleFieldVisibility: (fieldKey: string) => void;
  busy: Record<string, any>;
  pickClaudeWorkdir: () => void;
  saveDisabled: boolean;
  hasBlockingErrors: boolean;
  allFieldsValidated: boolean;
  changedKeys: string[];
  onSaveClick: () => void;
  apiBaseUrl: string;
}) {
  let stepNumber = 0;

  return (
    <section className="rounded-xl border border-secondary bg-primary p-3 shadow-sm sm:p-5">
      <div className="space-y-2">
        <h2 className="m-0 inline-flex items-center gap-2 text-lg font-semibold text-primary sm:text-xl">
          <Icon icon={Settings01} className="size-5" />
          Setup
        </h2>
        <p className="m-0 hidden text-sm text-tertiary sm:block">
          Follow the steps below to configure your automation. These values are persisted in your local <code>.env</code> file.
        </p>
      </div>

      {/* Board Validation Alert */}
      <div className="mt-4">
        <BoardValidationAlert apiBaseUrl={apiBaseUrl} />
      </div>

      <div className="mt-6 space-y-6">
        {SETUP_SECTIONS.map((section) => (
          <div key={section.key} className="space-y-4">
            <div className="space-y-1">
              <h3 className="m-0 text-md font-semibold text-primary">{section.title}</h3>
              <p className="m-0 text-sm text-tertiary">{section.description}</p>
            </div>

            {section.textKeys.length > 0 ? (
              <div className="space-y-4">
                {section.textKeys.map((fieldKey) => {
                  const field = TEXT_FIELD_BY_KEY[fieldKey];
                  if (!field) {
                    return null;
                  }

                  stepNumber += 1;

                  const validation = validationMap[field.key] || { level: 'neutral', message: '' };
                  const isSecretField = Boolean(field.password);
                  const isFieldVisible = Boolean(revealedFields[field.key]);
                  const hasInlineValidationIcon =
                    validation.level === 'success' || validation.level === 'error' || validation.level === 'warning';
                  const hasInlineActions = isSecretField || field.folderPicker;

                  return (
                    <div key={field.key} className="rounded-lg border border-secondary bg-secondary p-3 sm:p-4">
                      <div className="flex items-start gap-2 sm:gap-3">
                        <Badge type="pill-color" color="brand" size="sm" className="mt-0.5 shrink-0">
                          {stepNumber}
                        </Badge>

                        <div className="min-w-0 space-y-1">
                          <h4 className="m-0 text-sm font-semibold text-primary">
                            {field.help?.title || field.label}
                          </h4>
                          <p className="m-0 text-sm text-tertiary">{field.description}</p>
                        </div>
                      </div>

                      {field.help?.steps?.length ? (
                        <ol className="mt-3 list-decimal space-y-1 pl-6 text-sm text-tertiary sm:ml-9 sm:pl-4">
                          {field.help.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      ) : null}

                      <div className="mt-4 sm:ml-9">
                        <div className="flex items-stretch gap-2">
                          <div className="relative min-w-0 flex-1">
                            {field.selectOptions ? (
                              <Select
                                aria-label={field.label}
                                value={config[field.key] || ''}
                                onChange={(value) => {
                                  setConfig((prev) => ({ ...prev, [field.key]: value }));
                                }}
                                options={field.selectOptions.map((opt): SelectOption => ({
                                  value: opt.value,
                                  label: opt.label,
                                  icon: field.icon,
                                  description: opt.description
                                }))}
                                size="md"
                              />
                            ) : (
                              <Input
                                size="md"
                                aria-label={field.label}
                                type={isSecretField && !isFieldVisible ? 'password' : 'text'}
                                placeholder={field.placeholder}
                                wrapperClassName="h-11"
                                inputClassName={hasInlineValidationIcon ? 'pr-9' : undefined}
                                tooltipClassName={validation.level === 'error' ? 'hidden' : undefined}
                                value={config[field.key] || ''}
                                isInvalid={validation.level === 'error'}
                                onChange={(value) => {
                                  const nextValue = value || '';
                                  setConfig((prev) => ({ ...prev, [field.key]: nextValue }));
                                }}
                              />
                            )}
                            {hasInlineValidationIcon ? (
                              <Tooltip
                                title={validation.level === 'success' ? 'Valid' : validation.level === 'warning' ? 'Warning' : 'Error'}
                                description={validation.message || undefined}
                                placement="top"
                              >
                                <TooltipTrigger
                                  aria-label={`${field.label} ${validation.level}`}
                                  className={cx(
                                    'absolute top-1/2 -translate-y-1/2',
                                    field.selectOptions ? 'right-9' : 'right-3',
                                    validation.level === 'success'
                                      ? 'text-success-primary'
                                      : validation.level === 'warning'
                                        ? 'text-warning-primary'
                                        : 'text-error-primary'
                                  )}
                                >
                                  {validation.level === 'success' ? (
                                    <CheckCircle className="size-4" />
                                  ) : validation.level === 'warning' ? (
                                    <AlertCircle className="size-4" />
                                  ) : (
                                    <XCircle className="size-4" />
                                  )}
                                </TooltipTrigger>
                              </Tooltip>
                            ) : null}
                          </div>

                          {hasInlineActions ? (
                            <div className="inline-flex items-stretch gap-2 self-stretch">
                              {isSecretField ? (
                                <Button
                                  size="md"
                                  color="secondary"
                                  className="h-11 w-11 shrink-0"
                                  aria-label={isFieldVisible ? 'Hide Secret' : 'Reveal Secret'}
                                  iconLeading={isFieldVisible ? EyeOff : Eye}
                                  onPress={() => toggleFieldVisibility(field.key)}
                                />
                              ) : null}

                              {field.folderPicker ? (
                                <Button
                                  size="md"
                                  color="secondary"
                                  className="h-11 shrink-0"
                                  iconLeading={Folder}
                                  isLoading={Boolean(busy.pickWorkdir)}
                                  onPress={pickClaudeWorkdir}
                                >
                                  Choose Folder
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {field.selectOptions && config[field.key] ? (
                          <p className="m-0 mt-2 text-xs text-tertiary">
                            {field.selectOptions.find((opt) => opt.value === config[field.key])?.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {section.toggleKeys.length > 0 ? (
              <div className={cx('space-y-3', section.textKeys.length > 0 ? 'mt-1' : '')}>
                {section.toggleKeys.map((toggleKey) => {
                  const toggle = TOGGLE_BY_KEY[toggleKey];
                  if (!toggle) {
                    return null;
                  }

                  return (
                    <div key={toggle.key} className="rounded-lg border border-secondary bg-secondary p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-secondary">
                            <Icon icon={toggle.icon} className="size-4 shrink-0 text-fg-quaternary" />
                            <span>{toggle.label}</span>
                          </p>
                          <p className="m-0 text-sm text-tertiary">{toggle.description}</p>
                        </div>

                        <Toggle
                          aria-label={toggle.label}
                          size="md"
                          className="shrink-0"
                          isSelected={Boolean(config[toggle.key])}
                          onChange={(isSelected) => {
                            setConfig((prev) => ({ ...prev, [toggle.key]: isSelected }));
                          }}
                        />
                      </div>

                      {toggle.warning ? (
                        <div className="mt-3 flex items-start gap-2 rounded-sm bg-utility-warning-50 p-3 text-sm text-warning-primary">
                          <AlertCircle className="mt-0.5 size-4 shrink-0" />
                          <p className="m-0">{toggle.warning}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-4">
        <p className={cx('m-0 text-sm', saveDisabled ? 'text-warning-primary' : 'text-tertiary')}>
          {hasBlockingErrors
            ? 'Fix blocking errors before saving.'
            : !allFieldsValidated
              ? 'All fields must be validated before saving.'
              : changedKeys.length === 0
                ? 'There are no unsaved changes.'
                : `${changedKeys.length} pending change${changedKeys.length > 1 ? 's' : ''}.`}
        </p>
        <Button size="md" color="primary" iconLeading={Save01} isDisabled={saveDisabled} isLoading={Boolean(busy.save)} onPress={onSaveClick}>
          Save Configuration
        </Button>
      </div>
    </section>
  );
}
