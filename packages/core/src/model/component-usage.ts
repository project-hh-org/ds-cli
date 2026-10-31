export interface ComponentUsage {
  file: string;
  line: number;
  name: string;
  importedFrom: string | null;
  props: string[];
}
