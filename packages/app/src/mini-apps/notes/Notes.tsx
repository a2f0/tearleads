import { useState } from "react";
import "./Notes.css";

export function Notes() {
  const [text, setText] = useState("");

  return (
    <div className="notes">
      <textarea
        className="notes-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your notes here..."
      />
    </div>
  );
}
