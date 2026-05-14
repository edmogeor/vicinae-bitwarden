import { Action, ActionPanel, Detail, Icon } from '@vicinae/api';

interface VaultErrorProps {
  title: string;
  message: string;
  retry?: () => void;
}

export function VaultError({ title, message, retry }: VaultErrorProps) {
  const body = [
    `# ${title}`,
    '',
    '```',
    message,
    '```',
    '',
    retry ? '**Press `Enter` to retry.**' : '',
    '',
    '_Review the error text for personal info before sharing publicly._',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Detail
      markdown={body}
      actions={
        <ActionPanel>
          {retry && <Action title="Retry" icon={Icon.ArrowClockwise} onAction={retry} />}
          <Action.CopyToClipboard title="Copy Error" content={message} />
        </ActionPanel>
      }
    />
  );
}
