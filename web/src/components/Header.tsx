import { KeyRound, Leaf } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { editorKey, setEditorKey } from "../lib/api";
import { Button, Field, inputClass, Modal } from "./ui";

export function EditorKeyDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(editorKey());
  return (
    <Modal title="Team key" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setEditorKey(value.trim());
          window.location.reload(); // load the team's data with the key
        }}
      >
        <Field label="Key" hint="Needed to open and change projects on this server. Public report links work without it.">
          <input className={inputClass} type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <Button type="submit">Save</Button>
      </form>
    </Modal>
  );
}

export default function Header({ children, showKey }: { children?: ReactNode; showKey?: boolean }) {
  const [keyOpen, setKeyOpen] = useState(false);
  return (
    <header className="sticky top-0 z-[500] border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-emerald-800">
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-700 text-white">
            <Leaf className="size-4.5" />
          </span>
          GreenProof
        </Link>
        <div className="min-w-0 flex-1">{children}</div>
        {showKey && (
          <button onClick={() => setKeyOpen(true)} className="rounded-md p-2 text-stone-500 hover:bg-stone-100" title="Team key" aria-label="Team key">
            <KeyRound className="size-4" />
          </button>
        )}
      </div>
      {keyOpen && <EditorKeyDialog onClose={() => setKeyOpen(false)} />}
    </header>
  );
}
