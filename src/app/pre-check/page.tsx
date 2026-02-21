"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface checklist_item {
  id: "noise" | "microphone" | "internet" | "mindset";
  label: string;
  description: string;
}

const checklist_items: checklist_item[] = [
  {
    id: "noise",
    label: "주변 소음 확인",
    description: "조용한 공간인지 확인했고, 주변 알림 소리를 최소화했습니다.",
  },
  {
    id: "microphone",
    label: "마이크 상태",
    description: "마이크 권한과 입력 장치 연결이 정상입니다.",
  },
  {
    id: "internet",
    label: "인터넷 상태",
    description: "면접 중 끊김이 없도록 네트워크가 안정적입니다.",
  },
  {
    id: "mindset",
    label: "마음가짐 확인",
    description: "천천히 또렷하게 답변할 준비가 되었습니다.",
  },
];

interface checklist_state {
  noise: boolean;
  microphone: boolean;
  internet: boolean;
  mindset: boolean;
}

const initial_checklist_state: checklist_state = {
  noise: false,
  microphone: false,
  internet: false,
  mindset: false,
};

/**
 * Step4 준비 체크리스트 화면을 렌더링합니다.
 */
export default function PreCheckPage() {
  const router = useRouter();
  const [saved_contact] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return localStorage.getItem("ai_interview_contact") || "";
  });
  const [checklist_state, set_checklist_state] = useState<checklist_state>(initial_checklist_state);

  /**
   * 체크 항목을 토글합니다.
   */
  const handle_check_item_click = (item_id: checklist_item["id"]) => {
    set_checklist_state((prev_state) => ({
      ...prev_state,
      [item_id]: !prev_state[item_id],
    }));
  };

  /**
   * 모든 체크 항목 완료 여부를 계산합니다.
   */
  const is_all_checked = useMemo(() => {
    return checklist_items.every((item) => checklist_state[item.id]);
  }, [checklist_state]);

  /**
   * 모든 항목을 확인한 경우 다음 단계로 이동합니다.
   */
  const handle_next_click = () => {
    if (!is_all_checked) {
      return;
    }

    router.push("/interview");
  };

  return (
    <div className="min-h-screen bg-[#f2f3f5] px-4 py-6">
      <main className="mx-auto w-full max-w-[860px] rounded-3xl bg-[#f8f9fb] p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:p-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-[#101828]">준비 체크리스트</h1>
        <p className="mt-3 text-lg text-[#4a4f57]">
          면접 시작 전에 아래 4가지 항목을 확인해주세요.
        </p>
        <p className="mt-1 text-base text-[#8b9097]">연락처: {saved_contact || "미확인"}</p>

        <section className="mt-6 space-y-3">
          {checklist_items.map((item) => {
            const is_checked = checklist_state[item.id];

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handle_check_item_click(item.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  is_checked
                    ? "border-[#22c55e] bg-[#ecfdf3]"
                    : "border-[#d8dde6] bg-white hover:border-[#7a8aa3]"
                }`}
                aria-pressed={is_checked}
              >
                <p className="text-lg font-semibold text-[#101828]">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#9aa5b1] text-sm">
                    {is_checked ? "✓" : ""}
                  </span>
                  {item.label}
                </p>
                <p className="mt-2 text-sm text-[#4a4f57]">{item.description}</p>
              </button>
            );
          })}
        </section>

        <section className="mt-5 rounded-2xl bg-[#eceef1] px-4 py-3">
          <p className={`text-base font-semibold ${is_all_checked ? "text-[#166534]" : "text-[#4b5563]"}`}>
            {is_all_checked
              ? "모든 준비가 완료되었습니다. 다음 단계로 이동할 수 있습니다."
              : "체크리스트 4개 항목을 모두 확인하면 다음 버튼이 활성화됩니다."}
          </p>
        </section>

        <section className="mt-6">
          <button
            type="button"
            onClick={handle_next_click}
            disabled={!is_all_checked}
            className="h-[60px] w-full rounded-2xl bg-[#111827] text-2xl font-bold text-white shadow-[0_6px_14px_rgba(17,24,39,0.35)] transition enabled:hover:bg-[#1f2937] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            다음 단계로 이동
          </button>
        </section>
      </main>
    </div>
  );
}
