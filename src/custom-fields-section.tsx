import { Action, ActionPanel, Form, Icon } from '@vicinae/api';
import { Fragment, useState } from 'react';

export interface CustomField {
  id: number;
  name: string;
  value: string;
  type: number; // 0=Text, 1=Hidden, 2=Boolean
}

const FIELD_TYPES = [
  { title: 'Text', value: '0' },
  { title: 'Hidden', value: '1' },
  { title: 'Boolean', value: '2' },
];

interface CustomFieldsSectionProps {
  customFields: CustomField[];
  setCustomFields: React.Dispatch<React.SetStateAction<CustomField[]>>;
  notes?: string;
}

function renderFieldValue(
  field: CustomField,
  setCustomFields: React.Dispatch<React.SetStateAction<CustomField[]>>,
) {
  if (field.type === 1) {
    return (
      <Form.PasswordField
        id={`cf_value_${field.id}`}
        title="Field Value"
        value={field.value}
        onChange={(v) =>
          setCustomFields((prev) =>
            prev.map((f) => (f.id === field.id ? { ...f, value: String(v ?? '') } : f)),
          )
        }
      />
    );
  }
  if (field.type === 2) {
    return (
      <Form.Checkbox
        id={`cf_value_${field.id}`}
        label="Field Value"
        value={field.value === 'true'}
        onChange={(v) =>
          setCustomFields((prev) =>
            prev.map((f) => (f.id === field.id ? { ...f, value: String(!!v) } : f)),
          )
        }
      />
    );
  }
  return (
    <Form.TextField
      id={`cf_value_${field.id}`}
      title="Field Value"
      value={field.value}
      onChange={(v) =>
        setCustomFields((prev) =>
          prev.map((f) => (f.id === field.id ? { ...f, value: String(v ?? '') } : f)),
        )
      }
    />
  );
}

export default function CustomFieldsSection({
  customFields,
  setCustomFields,
  notes,
}: CustomFieldsSectionProps) {
  return (
    <>
      {notes !== undefined ? (
        <Form.TextArea id="notes" title="Notes" defaultValue={notes} />
      ) : (
        <Form.TextArea id="notes" title="Notes" />
      )}

      {customFields.length > 0 && (
        <>
          <Form.Separator />
          <Form.Description text="Custom Fields" />
        </>
      )}
      {customFields.map((field) => (
        <Fragment key={field.id}>
          <Form.TextField
            id={`cf_name_${field.id}`}
            title="Field Name"
            value={field.name}
            onChange={(v) =>
              setCustomFields((prev) =>
                prev.map((f) => (f.id === field.id ? { ...f, name: String(v ?? '') } : f)),
              )
            }
          />
          <Form.Dropdown
            id={`cf_type_${field.id}`}
            title="Field Type"
            value={String(field.type)}
            onChange={(v) =>
              setCustomFields((prev) =>
                prev.map((f) => {
                  if (f.id !== field.id) return f;
                  const newType = Number(v ?? '0');
                  const newValue =
                    newType === 2 ? (f.value === 'true' ? 'true' : 'false') : f.value;
                  return { ...f, type: newType, value: newValue };
                }),
              )
            }
          >
            {FIELD_TYPES.map((ft) => (
              <Form.Dropdown.Item key={ft.value} value={ft.value} title={ft.title} />
            ))}
          </Form.Dropdown>
          {renderFieldValue(field, setCustomFields)}
        </Fragment>
      ))}
    </>
  );
}
