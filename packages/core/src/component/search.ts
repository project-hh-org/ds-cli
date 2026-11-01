import type { ComponentSummary } from "./summary.js";

export const COMPONENT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  date: ["DatePicker", "Calendar", "DateInput"],
  select: ["Select", "Dropdown", "Combobox", "Autocomplete"],
  modal: ["Modal", "Dialog", "Sheet", "Drawer", "Popup"],
  button: ["Button", "IconButton"],
  input: ["Input", "TextField", "TextInput", "Textarea"],
  table: ["Table", "DataTable", "DataGrid"],
  badge: ["Badge", "Tag", "Chip", "StatusBadge"],
  toast: ["Toast", "Snackbar", "Alert", "Notification"],
  tabs: ["Tabs", "Tab", "SegmentedControl"],
  tooltip: ["Tooltip", "Popover"],
  checkbox: ["Checkbox", "Switch", "Toggle"],
  card: ["Card", "Panel", "KpiCard"],
};

/** 한국어 용어 → 영어 용어(COMPONENT_SYNONYMS의 키) */
const KOREAN_TERMS: Readonly<Record<string, string>> = {
  날짜: "date",
  달력: "date",
  선택: "select",
  드롭다운: "select",
  모달: "modal",
  팝업: "modal",
  다이얼로그: "modal",
  버튼: "button",
  입력: "input",
  표: "table",
  테이블: "table",
  배지: "badge",
  뱃지: "badge",
  태그: "badge",
  알림: "toast",
  토스트: "toast",
  탭: "tabs",
  툴팁: "tooltip",
  체크: "checkbox",
  카드: "card",
};

export interface ComponentMatch {
  name: string;
  module: string;
  score: number;
  why: string;
  usageCount: number;
}

const MIN_PROP_TERM_LENGTH = 3;
const EXACT_NAME_BONUS = 4;

const KOREAN_PARTICLES = "을|를|이|가|은|는|의|에|로|으로|과|와|도";
const KOREAN_RULES: readonly [RegExp, string][] = Object.entries(KOREAN_TERMS).map(([ko, en]) => [
  new RegExp(`^${ko}(${KOREAN_PARTICLES})?$`),
  en,
]);

/** `Form.TextInput` / `PrimaryButton` → [form, text, input] / [primary, button] */
function nameParts(name: string): string[] {
  return name
    .split(".")
    .flatMap((seg) =>
      seg
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(" "),
    )
    .map((p) => p.toLowerCase())
    .filter((p) => p !== "");
}

/** 단어 규칙보다 먼저 보는 구문 규칙. 구문 전체를 한 번에 소비한다("날짜 선택"의 "선택"은 select가 아니다). */
const KOREAN_PHRASES: readonly [RegExp, string][] = [[/날짜(?:를|은|는|이|가)?\s*(?:선택|고르)[가-힣]*/g, "date"]];

interface Terms {
  terms: string[];
  /** 한국어 번역으로만 생긴 용어 → 그 한국어 표현. 이름 전체 일치 보너스(+4)를 받지 않는다 */
  korean: Map<string, string>;
}

function termsOf(intent: string): Terms {
  const terms = new Set<string>();
  /** 사용자가 영어로 직접 쓴 용어 */
  const direct = new Set<string>();
  const korean = new Map<string, string>();
  const add = (t: string): void => {
    if (t.length < 2) return;
    terms.add(t);
    direct.add(t);
    // 영어 복수형("buttons") 폴백: 단수형도 용어로 쓴다.
    if (/^[a-z0-9]+$/.test(t) && t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) {
      terms.add(t.slice(0, -1));
      direct.add(t.slice(0, -1));
    }
  };
  let rest = intent;
  for (const [phrase, en] of KOREAN_PHRASES) {
    for (const found of rest.match(phrase) ?? []) {
      terms.add(en);
      if (!korean.has(en)) korean.set(en, found);
    }
    rest = rest.replace(phrase, " ");
  }
  for (const raw of rest.match(/[A-Za-z0-9]+|[가-힣]+/g) ?? []) {
    if (/^[가-힣]/.test(raw)) {
      terms.add(raw);
      for (const [rule, en] of KOREAN_RULES) {
        if (!rule.test(raw)) continue;
        terms.add(en);
        if (!korean.has(en)) korean.set(en, raw.replace(new RegExp(`(${KOREAN_PARTICLES})$`), ""));
      }
    } else {
      // camelCase는 조각으로 쪼개되 전체 소문자 형태도 남겨 정확한 이름 일치에 쓴다.
      if (raw.length >= 2) {
        terms.add(raw.toLowerCase());
        direct.add(raw.toLowerCase());
      }
      for (const part of nameParts(raw)) add(part);
    }
  }
  for (const t of direct) korean.delete(t);
  return { terms: [...terms], korean };
}

/**
 * 의도 문자열로 컴포넌트를 찾는다. 이름 전체 일치 +4(한국어를 번역한 용어는 제외), 이름 조각 일치 +3(용어당 1회), 동의어 그룹 소속 +2(그룹당 1회), props 이름의 camelCase 조각 일치 +1(용어당 1회).
 * 동의어 그룹은 용어가 그룹 키이거나 그룹 목록의 항목일 때 켜진다(`dropdown` → select 그룹의 Select).
 * import 없는 지역 사용(module "")은 제외한다. 정렬: score → usageCount → name → module.
 */
export function searchComponents(summaries: ComponentSummary[], intent: string): ComponentMatch[] {
  const { terms, korean } = termsOf(intent);
  if (terms.length === 0) return [];

  const groups = Object.entries(COMPONENT_SYNONYMS).filter(([key, list]) =>
    terms.some((t) => t === key || list.some((n) => n.toLowerCase() === t)),
  );

  const matches: ComponentMatch[] = [];
  for (const s of summaries) {
    if (s.module === "") continue;
    const parts = nameParts(s.name);
    let score = 0;
    const nameWhy: string[] = [];
    const synonymWhy: string[] = [];
    const propsWhy: string[] = [];

    const lowerName = s.name.toLowerCase();
    // 한국어를 번역한 용어는 이름 전체 일치 보너스를 받지 않는다("날짜 선택" → Select가 이름 일치로 오르는 것을 막는다).
    for (const t of terms) {
      if (t === lowerName && !korean.has(t)) {
        score += EXACT_NAME_BONUS;
        nameWhy.push("이름 전체 일치");
        break;
      }
    }
    for (const t of terms) {
      if (parts.includes(t)) {
        score += 3;
        const ko = korean.get(t);
        nameWhy.push(ko === undefined ? `이름 '${t}' 일치` : `한국어 '${ko}'→${t}`);
      }
    }
    for (const [key, list] of groups) {
      if (list.some((n) => n.toLowerCase() === s.name.toLowerCase())) {
        score += 2;
        synonymWhy.push(`동의어 ${key}→${s.name}`);
      }
    }
    for (const t of terms) {
      if (t.length < MIN_PROP_TERM_LENGTH) continue;
      const prop = s.props.find((p) => p.toLowerCase() === t || nameParts(p).includes(t));
      if (prop !== undefined) {
        score += 1;
        propsWhy.push(`props '${prop}'`);
      }
    }
    if (score > 0) {
      matches.push({
        name: s.name,
        module: s.module,
        score,
        why: [...nameWhy, ...synonymWhy, ...propsWhy].join("; "),
        usageCount: s.count,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score || b.usageCount - a.usageCount || a.name.localeCompare(b.name) || a.module.localeCompare(b.module));
}
