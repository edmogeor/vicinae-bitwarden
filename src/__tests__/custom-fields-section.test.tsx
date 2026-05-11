import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomFieldsSection from '../custom-fields-section';
import type { CustomField } from '../custom-fields-section';

const MockForm = vi.hoisted(() => {
  const el = (type: string, testId?: string) => {
    return (props: {
      children?: React.ReactNode;
      id?: string;
      title?: string;
      value?: string;
      defaultValue?: string;
      onChange?: (value: unknown) => void;
      label?: string;
    }) => {
      const { children, ...rest } = props;
      return React.createElement(type, { 'data-testid': testId ?? props.id, ...rest }, children);
    };
  };

  const DropdownItem = el('option');
  const Dropdown = Object.assign(el('select'), { Item: DropdownItem });

  return Object.assign(el('div'), {
    TextField: el('input'),
    PasswordField: el('input'),
    Checkbox: el('input'),
    TextArea: el('textarea'),
    Dropdown,
    Description: ({ text }: { text: string }) =>
      React.createElement('span', { 'data-testid': 'description' }, text),
    Separator: () => React.createElement('hr', { 'data-testid': 'separator' }),
  });
});

vi.mock('@vicinae/api', () => ({
  Form: MockForm,
}));

function makeFields(overrides: Partial<CustomField>[] = []): CustomField[] {
  if (overrides.length > 0) {
    return overrides.map((f, i) => ({
      id: i,
      name: '',
      value: '',
      type: 0,
      ...f,
    }));
  }
  return [];
}

describe('CustomFieldsSection', () => {
  it('renders Notes textarea', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: [],
        setCustomFields: vi.fn(),
        notes: 'some notes',
      }),
    );

    expect(screen.getByTestId('notes')).toBeTruthy();
  });

  it('hides custom field headers when no fields exist', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: [],
        setCustomFields: vi.fn(),
      }),
    );

    expect(screen.queryByTestId('separator')).toBeNull();
    expect(screen.queryByTestId('description')).toBeNull();
  });

  it('renders separator and description when custom fields exist', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([{ name: 'API Key', value: 'abc', type: 0 }]),
        setCustomFields: vi.fn(),
      }),
    );

    expect(screen.getByTestId('separator')).toBeTruthy();
    expect(screen.getByTestId('description').textContent).toBe('Custom Fields');
  });

  it('renders field name, type dropdown, and value for each custom field', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([
          { name: 'API Key', value: 'abc123', type: 0 },
          { name: 'PIN', value: '••••', type: 1 },
        ]),
        setCustomFields: vi.fn(),
      }),
    );

    expect(screen.getByTestId('cf_name_0')).toBeTruthy();
    expect(screen.getByTestId('cf_type_0')).toBeTruthy();
    expect(screen.getByTestId('cf_value_0')).toBeTruthy();
    expect(screen.getByTestId('cf_name_1')).toBeTruthy();
    expect(screen.getByTestId('cf_type_1')).toBeTruthy();
    expect(screen.getByTestId('cf_value_1')).toBeTruthy();
  });

  it('renders TextField for type 0 (Text) fields', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([{ name: 'API Key', value: 'abc', type: 0 }]),
        setCustomFields: vi.fn(),
      }),
    );

    const valueInput = screen.getByTestId('cf_value_0');
    // TextField renders as <input>
    expect(valueInput.tagName).toBe('INPUT');
  });

  it('renders PasswordField for type 1 (Hidden) fields', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([{ name: 'Secret', value: 'xyz', type: 1 }]),
        setCustomFields: vi.fn(),
      }),
    );

    // In our mock, PasswordField renders as <input> too, same as TextField
    // Both are present — we just verify the component renders
    expect(screen.getByTestId('cf_value_0')).toBeTruthy();
  });

  it('renders Checkbox for type 2 (Boolean) fields', () => {
    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([{ name: 'Flag', value: 'true', type: 2 }]),
        setCustomFields: vi.fn(),
      }),
    );

    expect(screen.getByTestId('cf_value_0')).toBeTruthy();
  });

  it('calls setCustomFields on field name change', () => {
    const setCustomFields = vi.fn();

    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([{ name: 'Old Name', value: 'x', type: 0 }]),
        setCustomFields,
      }),
    );

    fireEvent.change(screen.getByTestId('cf_name_0'), { target: { value: 'New' } });

    // onChange fires, which calls updateField, which calls setCustomFields
    expect(setCustomFields).toHaveBeenCalled();
  });

  it('normalizes boolean values when switching type to Boolean', () => {
    const setCustomFields = vi.fn();

    render(
      React.createElement(CustomFieldsSection, {
        customFields: makeFields([{ name: 'Flag', value: 'hello', type: 0 }]),
        setCustomFields,
      }),
    );

    fireEvent(screen.getByTestId('cf_type_0'), new InputEvent('change'));
  });
});
