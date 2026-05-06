import React from 'react';

export function makeFormMock(
  extras: Record<string, React.ComponentType<Record<string, unknown>>> = {},
) {
  return Object.assign(
    function Form({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
      return React.createElement('form', { 'data-testid': 'form' }, children, actions);
    },
    {
      PasswordField(props: { id: string; title: string; error?: string }) {
        return React.createElement('input', {
          type: 'password',
          'data-testid': props.id,
          placeholder: props.title,
        });
      },
      ...extras,
    },
  );
}
