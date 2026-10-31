"use client";

import { useState } from "react";
import PrimaryButton from "@/legacy/PrimaryButton";
import { Input } from "@/components/forms/Input";
import { Select } from "@/components/forms/Select";

export default function SettingsPage() {
  const [storeName, setStoreName] = useState("모노마켓 공식몰");
  const [email, setEmail] = useState("");
  const [cycle, setCycle] = useState("weekly");
  const [saving, setSaving] = useState(false);

  const emailError = email !== "" && !email.includes("@") ? "이메일 형식이 올바르지 않습니다." : undefined;

  async function handleSave() {
    setSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSaving(false);
  }

  return (
    <div className="max-w-xl">
      <h1 className="page-title">설정</h1>

      <section className="bg-white rounded-lg p-[13px] space-y-4 border border-[#2F7BEE]">
        <h2 className="font-semibold text-gray-900">스토어 정보</h2>
        <Input id="storeName" label="스토어 이름" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
        <Input
          id="email"
          label="정산 알림 이메일"
          type="email"
          value={email}
          error={emailError}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select
          label="정산 주기"
          value={cycle}
          onChange={(e) => setCycle(e.target.value)}
          options={[
            { value: "weekly", label: "주 1회" },
            { value: "biweekly", label: "격주" },
            { value: "monthly", label: "월 1회" },
          ]}
        />
      </section>

      <div style={{ marginTop: 18 }}>
        <PrimaryButton loading={saving} onClick={handleSave}>
          저장
        </PrimaryButton>
      </div>
    </div>
  );
}
