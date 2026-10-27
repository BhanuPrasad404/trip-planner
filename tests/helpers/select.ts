// Tests for screens that use our own <Select>: its choices live in a sheet that only opens on a tap, so a test reads the list from the
// component's props and "chooses" by calling its onChange with the value (what the sheet does when a row is tapped).
import type { ReactTestInstance } from "react-test-renderer";
import { Select, type SelectOption } from "@/components/ui/Select";

type AnySelectProps = { id?: string; value: string; options: readonly SelectOption[]; onChange: (v: string) => void };

export const selectNamed = (root: ReactTestInstance, id: string): ReactTestInstance => {
  const hits = root.findAll((n) => n.type === Select && (n.props as AnySelectProps).id === id);
  if (hits.length !== 1) throw new Error(`expected one Select with id "${id}", found ${hits.length}`);
  return hits[0];
};
export const optionsOf = (root: ReactTestInstance, id: string) => (selectNamed(root, id).props as AnySelectProps).options;
export const choose = (root: ReactTestInstance, id: string, value: string) => (selectNamed(root, id).props as AnySelectProps).onChange(value);
export const allSelects = (root: ReactTestInstance) => root.findAll((n) => n.type === Select).map((n) => n.props as AnySelectProps);
