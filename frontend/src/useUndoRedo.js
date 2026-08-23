import { useCallback, useEffect, useRef } from "react";

// Generic command-pattern undo/redo stack. Every mutating action in the
// app (add row, delete row, edit a cell, reorder, add/delete/rename a
// table...) pushes one entry: { undo, redo }, each a plain function that
// re-applies local state + fires the matching API call. Because deletes
// are soft (see db/migration_reorder_undo.sql) every id involved stays
// valid forever, so undo/redo can always find the row it's talking about
// -- no "undo brought back a row with a different id" problems.
export function useUndoRedo() {
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const push = useCallback((command) => {
    undoStack.current.push(command);
    redoStack.current = []; // a fresh action invalidates the redo branch
  }, []);

  const undo = useCallback(() => {
    const cmd = undoStack.current.pop();
    if (!cmd) return;
    cmd.undo();
    redoStack.current.push(cmd);
  }, []);

  const redo = useCallback(() => {
    const cmd = redoStack.current.pop();
    if (!cmd) return;
    cmd.redo();
    undoStack.current.push(cmd);
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      // Don't hijack Ctrl+Z/Y while someone's mid-edit in a text field --
      // let the browser's native input-level undo handle that instead.
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return { push, undo, redo };
}
