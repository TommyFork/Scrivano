import React from "react";
import type { SectionId } from "../types";

interface CollapsibleSectionProps {
  id: SectionId;
  title: string;
  openSection: SectionId | null;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  openSection,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const isOpen = openSection === id;
  return (
    <div className="collapsible-section">
      <button className="section-header" onClick={() => onToggle(id)}>
        <span className="section-title">{title}</span>
        <span className={`section-chevron ${isOpen ? "open" : ""}`}>&#x25B8;</span>
      </button>
      {isOpen && <div className="section-body">{children}</div>}
    </div>
  );
}
