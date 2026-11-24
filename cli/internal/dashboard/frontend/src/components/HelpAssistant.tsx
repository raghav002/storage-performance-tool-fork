import {
  ActionIcon,
  Affix,
  Button,
  CloseButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { CircleHelp } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { faq, suggest, type FaqEntry } from "../help/faq";

type Message =
  | { id: number; kind: "question"; text: string }
  | { id: number; kind: "suggestions"; entries: FaqEntry[] }
  | { id: number; kind: "answer"; entry: FaqEntry }
  | { id: number; kind: "no-match" }
  | { id: number; kind: "browse" };

// Omit "id" from each member of the union separately.
type WithoutID<M> = M extends unknown ? Omit<M, "id"> : never;
type NewMessage = WithoutID<Message>;

function Bubble({
  from,
  children,
}: {
  from: "user" | "assistant";
  children: ReactNode;
}) {
  return (
    <div
      className={
        from === "user"
          ? "ml-8 self-end rounded-lg bg-(--spt-surface-selected) px-3 py-2"
          : "mr-4 self-start rounded-lg bg-(--spt-surface-subtle) px-3 py-2"
      }
    >
      {children}
    </div>
  );
}

function QuestionButtons({
  entries,
  onPick,
}: {
  entries: FaqEntry[];
  onPick: (entry: FaqEntry) => void;
}) {
  return (
    <Stack gap={4} mt={6}>
      {entries.map((entry) => (
        <Button
          key={entry.id}
          variant="default"
          size="compact-sm"
          justify="flex-start"
          className="h-auto! whitespace-normal! py-1! text-left"
          onClick={() => onPick(entry)}
        >
          {entry.question}
        </Button>
      ))}
    </Stack>
  );
}

/**
 * A floating help button that matches a typed question against prewritten
 * questions and offers the closest ones under "Did you mean?". Picking one
 * shows its prewritten answer. Everything runs in the browser.
 */
export function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const nextID = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const add = (...items: NewMessage[]) =>
    setMessages((current) => [
      ...current,
      ...items.map((item) => ({ ...item, id: nextID.current++ }) as Message),
    ]);

  const ask = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const entries = suggest(text);
    add(
      { kind: "question", text },
      entries.length ? { kind: "suggestions", entries } : { kind: "no-match" },
    );
  };

  const pick = (entry: FaqEntry) =>
    add({ kind: "question", text: entry.question }, { kind: "answer", entry });

  return (
    <Affix position={{ bottom: 20, right: 20 }} zIndex={300}>
      {open ? (
        <Paper
          withBorder
          shadow="md"
          radius="md"
          role="dialog"
          aria-label="Help"
          className="flex max-h-[min(36rem,calc(100vh-40px))] w-[min(22.5rem,calc(100vw-32px))] flex-col"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <Group
            justify="space-between"
            px="md"
            py="xs"
            className="border-b border-(--spt-border-divider)"
          >
            <Text fw={600}>Help</Text>
            <CloseButton
              aria-label="Close help"
              onClick={() => setOpen(false)}
            />
          </Group>
          <div
            ref={transcript}
            className="flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto p-3"
            aria-live="polite"
          >
            <Bubble from="assistant">
              <Text size="sm">
                Ask a question about the dashboard in your own words, and I'll
                suggest matching questions with prewritten answers.
              </Text>
            </Bubble>
            {messages.map((message) => {
              switch (message.kind) {
                case "question":
                  return (
                    <Bubble key={message.id} from="user">
                      <Text size="sm">{message.text}</Text>
                    </Bubble>
                  );
                case "suggestions":
                  return (
                    <Bubble key={message.id} from="assistant">
                      <Text size="sm" fw={600}>
                        Did you mean?
                      </Text>
                      <QuestionButtons
                        entries={message.entries}
                        onPick={pick}
                      />
                    </Bubble>
                  );
                case "answer":
                  return (
                    <Bubble key={message.id} from="assistant">
                      <Stack gap={6}>
                        {message.entry.answer.map((paragraph) => (
                          <Text key={paragraph} size="sm">
                            {paragraph}
                          </Text>
                        ))}
                        <Text size="xs" c="var(--spt-text-muted)">
                          Source: {message.entry.source}
                        </Text>
                      </Stack>
                    </Bubble>
                  );
                case "no-match":
                  return (
                    <Bubble key={message.id} from="assistant">
                      <Text size="sm">
                        I couldn't find a matching question. Try rewording it,
                        or browse all questions.
                      </Text>
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        mt={4}
                        onClick={() => add({ kind: "browse" })}
                      >
                        Browse all questions
                      </Button>
                    </Bubble>
                  );
                case "browse":
                  return (
                    <Bubble key={message.id} from="assistant">
                      <Text size="sm" fw={600}>
                        All questions
                      </Text>
                      <QuestionButtons entries={faq} onPick={pick} />
                    </Bubble>
                  );
              }
            })}
          </div>
          <form
            onSubmit={ask}
            className="flex gap-2 border-t border-(--spt-border-divider) p-3"
          >
            <TextInput
              aria-label="Your question"
              placeholder="Type a question"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              className="flex-1"
              autoFocus
            />
            <Button type="submit" disabled={!draft.trim()}>
              Ask
            </Button>
          </form>
        </Paper>
      ) : (
        <ActionIcon
          size={48}
          radius="xl"
          aria-label="Help"
          title="Help"
          onClick={() => setOpen(true)}
        >
          <CircleHelp size={26} aria-hidden="true" />
        </ActionIcon>
      )}
    </Affix>
  );
}
