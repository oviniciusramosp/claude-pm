// panel/src/components/base/select/select.tsx

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Icon } from '@/components/icon';
import { cx } from '@/utils/cx';

export interface SelectOption {
  value: string;
  label: string;
  badge?: {
    color: 'gray' | 'brand' | 'error' | 'warning' | 'success' | 'blue' | 'indigo' | 'purple' | 'pink' | 'orange' | 'gray-blue';
    text?: string;
  };
  icon?: React.ComponentType<{ className?: string }>;
  description?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className,
  size = 'md',
  'aria-label': ariaLabel
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
      setFocusedIndex(-1);
      buttonRef.current?.focus();
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setFocusedIndex(0);
          } else if (focusedIndex >= 0) {
            const focusedOption = options[focusedIndex];
            if (focusedOption && !focusedOption.disabled) {
              handleSelect(focusedOption.value);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setFocusedIndex(-1);
          buttonRef.current?.focus();
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setFocusedIndex(0);
          } else {
            setFocusedIndex((prev) => {
              const next = prev + 1;
              return next >= options.length ? 0 : next;
            });
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (isOpen) {
            setFocusedIndex((prev) => {
              const next = prev - 1;
              return next < 0 ? options.length - 1 : next;
            });
          }
          break;
        case 'Home':
          e.preventDefault();
          if (isOpen) {
            setFocusedIndex(0);
          }
          break;
        case 'End':
          e.preventDefault();
          if (isOpen) {
            setFocusedIndex(options.length - 1);
          }
          break;
      }
    },
    [disabled, isOpen, focusedIndex, options, handleSelect]
  );

  // Scroll focused option into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && dropdownRef.current) {
      const focusedElement = dropdownRef.current.children[focusedIndex] as HTMLElement;
      if (focusedElement) {
        focusedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex, isOpen]);

  const sizeClasses = size === 'sm' ? 'text-xs py-1.5 px-2.5' : 'text-sm py-2 px-3';
  const buttonClasses = cx(
    'relative w-full flex items-center justify-between gap-2 rounded-lg border bg-primary shadow-xs transition',
    sizeClasses,
    disabled
      ? 'border-secondary text-disabled cursor-not-allowed'
      : 'border-secondary text-primary hover:border-brand-solid focus:border-brand-solid focus:outline-none focus:ring-1 focus:ring-brand-solid',
    className
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={buttonClasses}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption ? (
            <>
              {selectedOption.icon && (
                <Icon icon={selectedOption.icon} className="size-4 shrink-0 text-tertiary" />
              )}
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.badge && (
                <Badge size="sm" color={selectedOption.badge.color}>
                  {selectedOption.badge.text || selectedOption.label}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-quaternary">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={cx('size-4 shrink-0 text-quaternary transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 z-50 mt-1 w-full min-w-[200px] max-h-64 overflow-y-auto rounded-lg border border-secondary bg-primary shadow-lg"
          role="listbox"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isFocused = index === focusedIndex;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => !option.disabled && handleSelect(option.value)}
                disabled={option.disabled}
                className={cx(
                  'w-full px-3 py-2 text-left flex items-center gap-2 transition',
                  'first:rounded-t-lg last:rounded-b-lg',
                  option.disabled
                    ? 'text-disabled cursor-not-allowed'
                    : 'hover:bg-primary_hover',
                  isSelected && 'bg-utility-brand-50',
                  isFocused && !option.disabled && 'bg-primary_hover ring-1 ring-inset ring-brand-solid'
                )}
                role="option"
                aria-selected={isSelected}
              >
                {option.icon && (
                  <Icon icon={option.icon} className="size-4 shrink-0 text-tertiary" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cx('text-sm truncate', isSelected ? 'font-medium text-brand-secondary' : 'text-primary')}>
                      {option.label}
                    </span>
                    {option.badge && (
                      <Badge size="sm" color={option.badge.color}>
                        {option.badge.text || option.label}
                      </Badge>
                    )}
                  </div>
                  {option.description && (
                    <p className="text-xs text-tertiary mt-0.5">{option.description}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
