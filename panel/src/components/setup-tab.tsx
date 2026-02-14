// panel/src/components/setup-tab.tsx

import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Folder,
  HelpCircle,
  LinkExternal01,
  Save01,
  Settings01,
  XCircle
} from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Toggle } from '@/components/base/toggle/toggle';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { cx } from '@/utils/cx';
import {
  SETUP_SECTIONS,
  TEXT_FIELD_BY_KEY,
  TOGGLE_BY_KEY
} from '../constants';
import { helpTooltipContent } from '../utils/log-helpers';
import { Icon } from './icon';
import type { ValidationResult } from '../types';

export function SetupTab({
  config,
  setConfig,
  validationMap,
  revealedFields,
  toggleFieldVisibility,
  notionDatabaseUrl,
  busy,
  pickClaudeWorkdir,
  saveDisabled,
  hasBlockingErrors,
  allFieldsValidated,
  changedKeys,
  onSaveClick
}: {
  config: Record<string, any>;
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  validationMap: Record<string, ValidationResult>;
  revealedFields: Record<string, boolean>;
  toggleFieldVisibility: (fieldKey: string) => void;
  notionDatabaseUrl: string;
  busy: Record<string, any>;
  pickClaudeWorkdir: () => void;
  saveDisabled: boolean;
  hasBlockingErrors: boolean;
  allFieldsValidated: boolean;
  changedKeys: string[];
  onSaveClick: () => void;
}) {
  return (
    <section className="rounded-2xl border border-secondary bg-primary p-5 shadow-sm">
      <div className="space-y-2">
        <h2 className="m-0 inline-flex items-center gap-2 text-xl font-semibold text-primary">
          <Icon icon={Settings01} className="size-5" />
          Setup Configuration
        </h2>
        <p className="m-0 text-sm text-tertiary">These values are persisted in your local <code>.env</code> file.</p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {SETUP_SECTIONS.map((section) => (
          <div key={section.key} className="rounded-xl border border-secondary bg-secondary p-4">
            <div className="mb-3 space-y-1">
              <h3 className="m-0 text-md font-semibold text-primary">{section.title}</h3>
              <p className="m-0 text-sm text-tertiary">{section.description}</p>
            </div>

            {section.textKeys.length > 0 ? (
              <div className="space-y-3">
                {section.textKeys.map((fieldKey) => {
                  const field = TEXT_FIELD_BY_KEY[fieldKey];
                  if (!field) {
                    return null;
                  }

                  const validation = validationMap[field.key] || { level: 'neutral', message: '' };
                  const isSecretField = Boolean(field.password);
                  const isFieldVisible = Boolean(revealedFields[field.key]);
                  const hasInlineValidationIcon =
                    validation.level === 'success' || validation.level === 'error' || validation.level === 'warning';
                  const validationStatusLabel =
                    validation.level === 'success' ? 'Success' : validation.level === 'error' ? 'Error' : validation.level === 'warning' ? 'Warning' : '';
                  const hasInlineActions = isSecretField || field.key === 'NOTION_DATABASE_ID' || field.folderPicker;

                  return (
                    <div key={field.key} className="space-y-3 rounded-xl border border-secondary bg-primary p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-secondary">
                          <Icon icon={field.icon} className="size-4 text-fg-quaternary" />
                          {field.label}
                        </p>

                        <Tooltip title={field.help?.title || field.label} description={helpTooltipContent(field.description, field.help)} placement="top end">
                          <TooltipTrigger aria-label={`Help for ${field.label}`} className="rounded-md p-1 text-fg-quaternary hover:text-fg-quaternary_hover">
                            <HelpCircle className="size-4" />
                          </TooltipTrigger>
                        </Tooltip>
                      </div>

                      <div className="flex items-stretch gap-2">
                        <div className="relative min-w-0 flex-1">
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
                          {hasInlineValidationIcon ? (
                            <Tooltip title={validationStatusLabel} description={validation.message || undefined} placement="top">
                              <TooltipTrigger
                                aria-label={`${field.label} ${validationStatusLabel.toLowerCase()}`}
                                className={cx(
                                  'absolute right-3 top-1/2 -translate-y-1/2',
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
                              <Tooltip title={isFieldVisible ? 'Hide Secret Value' : 'Reveal Secret Value'} placement="top">
                                <Button
                                  size="md"
                                  color="secondary"
                                  className="h-11 w-11 shrink-0"
                                  aria-label={isFieldVisible ? 'Hide Secret' : 'Reveal Secret'}
                                  iconLeading={isFieldVisible ? EyeOff : Eye}
                                  onPress={() => toggleFieldVisibility(field.key)}
                                />
                              </Tooltip>
                            ) : null}

                            {field.key === 'NOTION_DATABASE_ID' ? (
                              <Tooltip
                                title={notionDatabaseUrl ? 'Open This Database in a New Tab' : 'Enter a valid 32-char database ID to enable this button'}
                                placement="top"
                              >
                                <span>
                                  <Button
                                    size="md"
                                    color="secondary"
                                    className="h-11 w-11 shrink-0"
                                    aria-label="Open in Notion"
                                    iconLeading={LinkExternal01}
                                    isDisabled={!notionDatabaseUrl}
                                    onPress={() => {
                                      if (!notionDatabaseUrl) {
                                        return;
                                      }
                                      window.open(notionDatabaseUrl, '_blank', 'noopener,noreferrer');
                                    }}
                                  />
                                </span>
                              </Tooltip>
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
                    </div>
                  );
                })}
              </div>
            ) : null}

            {section.toggleKeys.length > 0 ? (
              <div className={cx('space-y-3', section.textKeys.length > 0 ? 'mt-3' : '')}>
                {section.toggleKeys.map((toggleKey) => {
                  const toggle = TOGGLE_BY_KEY[toggleKey];
                  if (!toggle) {
                    return null;
                  }

                  return (
                    <div key={toggle.key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-secondary bg-primary p-4">
                      <div className="min-w-0 space-y-1">
                        <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-secondary">
                          <Icon icon={toggle.icon} className="size-4 text-fg-quaternary" />
                          {toggle.label}
                        </p>
                        <p className="m-0 text-sm text-tertiary">{toggle.description}</p>
                      </div>

                      <Toggle
                        aria-label={toggle.label}
                        size="md"
                        isSelected={Boolean(config[toggle.key])}
                        onChange={(isSelected) => {
                          setConfig((prev) => ({ ...prev, [toggle.key]: isSelected }));
                        }}
                      />
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
