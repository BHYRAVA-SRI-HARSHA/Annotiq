import { useMemo, useState } from "react";
import { useAnnotationStore } from "../state/annotationStore";
import { buildAnnotationTree, AnnotationTreeNode, getValidationIssues } from "../state/types";
import { Annotation } from "@/shared/api/types";
import { TrashIcon, EyeIcon, EyeOffIcon, LockIcon, UnlockIcon, ChevronDownIcon, BoxIcon } from "@/shared/ui/icons";

type FilterField = "transcription" | "writingType";
type FilterValue = "filled" | "empty" | "equals" | "handwritten" | "printed" | "any";

interface RootGroup {
  labelName: string;
  nodes: AnnotationTreeNode[];
}

function groupRootsByLabel(nodes: AnnotationTreeNode[]): RootGroup[] {
  const map = new Map<string, AnnotationTreeNode[]>();
  const order: string[] = [];
  nodes.forEach((n) => {
    const name = n.annotation.labelName;
    if (!map.has(name)) {
      map.set(name, []);
      order.push(name);
    }
    map.get(name)!.push(n);
  });
  return order.map((labelName) => ({ labelName, nodes: map.get(labelName)! }));
}

// Keeps a Word node only if it matches the active filter's predicate;
// keeps a container/Line node only if at least one descendant survived (or
// it had no children to begin with, in which case the filter doesn't apply
// to it either way). Shared by both filter fields (Transcription,
// Handwritten/Printed) — the predicate is the only thing that changes.
function filterTreeByPredicate(
  nodes: AnnotationTreeNode[],
  predicate: (a: Annotation) => boolean
): AnnotationTreeNode[] {
  function walk(node: AnnotationTreeNode): AnnotationTreeNode | null {
    const children = node.children.map(walk).filter((n): n is AnnotationTreeNode => n !== null);
    if (node.annotation.labelName === "Word") {
      return predicate(node.annotation) ? { ...node, children } : null;
    }
    if (node.children.length === 0) return node;
    if (children.length === 0) return null;
    return { ...node, children };
  }
  return nodes.map(walk).filter((n): n is AnnotationTreeNode => n !== null);
}

function countNodes(nodes: AnnotationTreeNode[]): number {
  let total = 0;
  function walk(node: AnnotationTreeNode) {
    total += 1;
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return total;
}

function countDescendantWords(node: AnnotationTreeNode): number {
  let count = 0;
  function walk(n: AnnotationTreeNode) {
    if (n.annotation.labelName === "Word") count += 1;
    n.children.forEach(walk);
  }
  node.children.forEach(walk);
  return count;
}

function collectWordTexts(node: AnnotationTreeNode): string[] {
  const out: string[] = [];
  function walk(n: AnnotationTreeNode) {
    if (n.annotation.labelName === "Word") {
      const t = n.annotation.properties.transcription?.trim();
      if (t) out.push(t);
    }
    n.children.forEach(walk);
  }
  node.children.forEach(walk);
  return out;
}

// "VI., ASSETS, AND LIABILIT…" — a Line/container's row shows its label
// plus a preview of the text underneath it; a bare Word just shows its own
// transcription (falling back to the label name when it hasn't been
// transcribed yet).
function nodeLabel(node: AnnotationTreeNode): string {
  const { annotation, children } = node;
  if (annotation.labelName === "Word") {
    return annotation.properties.transcription?.trim() || "(empty)";
  }
  if (children.length > 0) {
    const words = collectWordTexts(node);
    if (words.length > 0) return `${annotation.labelName} - ${words.join(", ")}`;
  }
  return annotation.properties.transcription?.trim()
    ? `${annotation.labelName} · ${annotation.properties.transcription}`
    : annotation.labelName;
}

// Sec. 2.5: "Mode:" toggle switches between Line mode (Line -> Word) and
// the default KV-tree mode (GroupedContainer -> KeyValueContainer ->
// Key/Value -> Word) — see state/types.ts for how the two independent
// parent pointers make this possible.
export function AnnotationTree() {
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedIds = useAnnotationStore((s) => s.selectedIds);
  const select = useAnnotationStore((s) => s.select);
  const focusAnnotation = useAnnotationStore((s) => s.focusAnnotation);
  const treeMode = useAnnotationStore((s) => s.treeMode);
  const setTreeMode = useAnnotationStore((s) => s.setTreeMode);
  const requestDeleteSelected = useAnnotationStore((s) => s.requestDeleteSelected);
  const ontology = useAnnotationStore((s) => s.ontology);
  const labelVisibility = useAnnotationStore((s) => s.labelVisibility);
  const toggleLabelVisibility = useAnnotationStore((s) => s.toggleLabelVisibility);
  const toggleLabelLock = useAnnotationStore((s) => s.toggleLabelLock);
  const setAllLabelsVisible = useAnnotationStore((s) => s.setAllLabelsVisible);

  const [search, setSearch] = useState("");
  const [filterField, setFilterField] = useState<FilterField>("transcription");
  const [filterValue, setFilterValue] = useState<FilterValue>("filled");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const hasSelection = selectedIds.length > 0;
  const tree = useMemo(() => buildAnnotationTree(annotations, treeMode), [annotations, treeMode]);
  const issues = useMemo(() => getValidationIssues(annotations), [annotations]);

  const filteredTree = useMemo(() => {
    if (filterField === "writingType") {
      const predicate = (a: Annotation) => {
        if (filterValue === "handwritten") return a.properties.writingType === "Handwritten";
        if (filterValue === "printed") return a.properties.writingType === "Printed";
        return true; // "any" — filtering by field alone still limits to Words, same as the other field
      };
      return filterTreeByPredicate(tree, predicate);
    }
    const predicate = (a: Annotation) => {
      const filled = Boolean(a.properties.transcription && a.properties.transcription.trim() !== "");
      if (filterValue === "filled") return filled;
      if (filterValue === "empty") return !filled;
      if (filterValue === "equals") return (a.properties.transcription ?? "") === search;
      return true;
    };
    return filterTreeByPredicate(tree, predicate);
  }, [tree, filterField, filterValue, search]);

  function colorFor(labelName: string): string {
    return ontology?.labels.find((l) => l.name === labelName)?.color ?? "#888";
  }

  function toggleGroup(labelName: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(labelName)) next.delete(labelName);
      else next.add(labelName);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups = useMemo(() => groupRootsByLabel(filteredTree), [filteredTree]);
  const filteredCount = countNodes(filteredTree);

  return (
    <div
      style={{
        width: 260,
        borderLeft: "1px solid var(--color-border)",
        padding: "10px 10px",
        overflowY: "auto",
        flex: 1,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="panel-header__title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="panel-header__dot" />
          Annotations ({annotations.length})
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="chip-link" onClick={() => setAllLabelsVisible(true)}>
            Show all
          </button>
          <button className="chip-link" onClick={() => setAllLabelsVisible(false)}>
            Hide all
          </button>
          <button
            onClick={requestDeleteSelected}
            disabled={!hasSelection}
            title="Delete selected"
            style={{
              ...iconBtnStyle,
              width: 24,
              height: 24,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              opacity: hasSelection ? 1 : 0.4,
              cursor: hasSelection ? "pointer" : "default",
            }}
          >
            <TrashIcon size={13} />
          </button>
        </span>
      </div>

      {issues.length > 0 && (
        <div className="banner-warn" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--color-danger)" }}>
            ⚠ {issues.length} issue{issues.length > 1 ? "s" : ""} to resolve before submit
          </span>
          {issues.map((issue, i) => (
            <button
              key={`${issue.annotationId}-${i}`}
              onClick={() => focusAnnotation(issue.annotationId)}
              title="Jump to this element"
              style={{
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "3px 2px",
                color: "#c94f4f",
                fontSize: 12,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {issue.message}
            </button>
          ))}
        </div>
      )}

      <input
        placeholder="Search text or ID…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={searchInputStyle}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "12px 0 6px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--color-text-muted)" }}>
          FILTER
        </span>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{filteredCount} elements</span>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <select
          value={filterField}
          onChange={(e) => {
            const field = e.target.value as FilterField;
            setFilterField(field);
            // Each field's FilterValue options are disjoint (filled/empty/
            // equals vs handwritten/printed/any) — switching fields without
            // resetting this would leave e.g. "empty" selected while the
            // dropdown now only offers Handwritten/Printed/Any options.
            setFilterValue(field === "writingType" ? "any" : "filled");
          }}
          style={filterSelectStyle}
        >
          <option value="transcription">Transcription</option>
          <option value="writingType">Handwritten / Printed</option>
        </select>
        {filterField === "writingType" ? (
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value as FilterValue)}
            style={filterSelectStyle}
          >
            <option value="any">Any</option>
            <option value="handwritten">Handwritten</option>
            <option value="printed">Printed</option>
          </select>
        ) : (
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value as FilterValue)}
            style={filterSelectStyle}
          >
            <option value="filled">Filled</option>
            <option value="empty">Empty</option>
            <option value="equals">Equals</option>
          </select>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span>Mode:</span>
        <button
          onClick={() => setTreeMode(treeMode === "kv" ? "line" : "kv")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--color-border)",
            borderRadius: 999,
            background: "var(--color-bg)",
            padding: "3px 10px",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: treeMode === "line" ? "var(--color-accent)" : "var(--color-amber)",
              display: "inline-block",
            }}
          />
          {treeMode === "line" ? "Line mode" : "KV mode"}
        </button>
      </div>

      {groups.map((group) => (
        <GroupSection
          key={group.labelName}
          labelName={group.labelName}
          nodes={group.nodes}
          color={colorFor(group.labelName)}
          collapsed={collapsedGroups.has(group.labelName)}
          onToggleCollapse={() => toggleGroup(group.labelName)}
          visible={labelVisibility[group.labelName]?.visible ?? true}
          locked={labelVisibility[group.labelName]?.locked ?? false}
          onToggleVisible={() => toggleLabelVisibility(group.labelName)}
          onToggleLock={() => toggleLabelLock(group.labelName)}
          search={search}
          selectedIds={selectedIds}
          onSelect={select}
          expandedNodes={expandedNodes}
          onToggleExpand={toggleExpand}
        />
      ))}

      {groups.length === 0 && (
        <p style={{ fontSize: 12.5, color: "var(--color-text-muted)", marginTop: 16 }}>No elements match.</p>
      )}
    </div>
  );
}

function GroupSection({
  labelName,
  nodes,
  color,
  collapsed,
  onToggleCollapse,
  visible,
  locked,
  onToggleVisible,
  onToggleLock,
  search,
  selectedIds,
  onSelect,
  expandedNodes,
  onToggleExpand,
}: {
  labelName: string;
  nodes: AnnotationTreeNode[];
  color: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  visible: boolean;
  locked: boolean;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  search: string;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  expandedNodes: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={onToggleCollapse}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 2px", cursor: "pointer", userSelect: "none" }}
      >
        <ChevronDownIcon
          size={12}
          style={{
            transform: collapsed ? "rotate(-90deg)" : "none",
            color: "var(--color-text-muted)",
            flexShrink: 0,
          }}
        />
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block", flexShrink: 0 }} />
        <strong style={{ fontSize: 13, fontWeight: 600 }}>{labelName}</strong>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{nodes.length}</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible();
          }}
          title={visible ? "Hide label" : "Show label"}
          style={iconBtnStyle}
        >
          {visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          title={locked ? "Unlock label" : "Lock label"}
          style={iconBtnStyle}
        >
          {locked ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
        </button>
      </div>
      {!collapsed &&
        nodes.map((node) => (
          <TreeRow
            key={node.annotation.id}
            node={node}
            depth={0}
            search={search}
            selectedIds={selectedIds}
            onSelect={onSelect}
            expandedNodes={expandedNodes}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  search,
  selectedIds,
  onSelect,
  expandedNodes,
  onToggleExpand,
}: {
  node: AnnotationTreeNode;
  depth: number;
  search: string;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  expandedNodes: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  const label = nodeLabel(node);
  const hasChildren = node.children.length > 0;
  const matches =
    search === "" ||
    label.toLowerCase().includes(search.toLowerCase()) ||
    node.annotation.id.toLowerCase().includes(search.toLowerCase());
  if (!matches && !hasChildren) return null;

  const isSelected = selectedIds.includes(node.annotation.id);
  const isExpanded = expandedNodes.has(node.annotation.id);
  const wordCount = hasChildren ? countDescendantWords(node) : 0;

  return (
    <div>
      <div
        onClick={(e) => onSelect(node.annotation.id, e.shiftKey)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: `4px 4px 4px ${6 + depth * 14}px`,
          fontSize: 12.5,
          cursor: "pointer",
          background: isSelected ? "var(--color-accent-soft)" : "transparent",
          borderLeft: isSelected ? "3px solid var(--color-accent)" : "3px solid transparent",
          marginLeft: -3,
          borderRadius: 4,
        }}
      >
        {hasChildren ? (
          <ChevronDownIcon
            size={11}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.annotation.id);
            }}
            style={{
              transform: isExpanded ? "none" : "rotate(-90deg)",
              color: "var(--color-text-muted)",
              flexShrink: 0,
              cursor: "pointer",
            }}
          />
        ) : (
          <span style={{ width: 11, flexShrink: 0, display: "inline-block" }} />
        )}
        <BoxIcon size={12} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
        {hasChildren && <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0 }}>{wordCount}</span>}
      </div>
      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.annotation.id}
            node={child}
            depth={depth + 1}
            search={search}
            selectedIds={selectedIds}
            onSelect={onSelect}
            expandedNodes={expandedNodes}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </div>
  );
}

const linkBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-accent)",
  fontSize: 12.5,
  cursor: "pointer",
  padding: 0,
};

const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  borderRadius: 4,
  width: 22,
  height: 22,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  flexShrink: 0,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 13,
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  background: "var(--color-bg)",
  color: "var(--color-text)",
};

const filterSelectStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 6px",
  fontSize: 12.5,
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  background: "var(--color-surface)",
  color: "var(--color-text)",
};
