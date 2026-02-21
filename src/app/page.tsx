"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const keypad_values = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const max_phone_length = 11;
const make_webhook_url = "https://hook.us2.make.com/cp1vdl3h0ghztzs28kp8jtdw7l37ink1";
type submit_result_tone = "success" | "error" | "info";

interface make_webhook_response {
  success?: boolean;
  code?: string;
  message?: string;
}

/**
 * 문자열이 JSON 형태인지(객체/배열) 1차적으로 확인합니다.
 */
const is_json_like_text = (input_text: string) => {
  const trimmed_text = input_text.trim();

  if (!trimmed_text) {
    return false;
  }

  return (
    (trimmed_text.startsWith("{") && trimmed_text.endsWith("}")) ||
    (trimmed_text.startsWith("[") && trimmed_text.endsWith("]"))
  );
};

/**
 * 전화번호 입력 화면 UI를 렌더링합니다.
 */
export default function Home() {
  const router = useRouter();
  const [raw_phone_number, set_raw_phone_number] = useState("");
  const [is_submitting, set_is_submitting] = useState(false);
  const [submit_result_message, set_submit_result_message] = useState("");
  const [submit_result_tone, set_submit_result_tone] = useState<submit_result_tone>("info");

  /**
   * 입력된 숫자를 사람이 읽기 쉬운 010-XXXX-XXXX 형태로 포맷팅합니다.
   */
  const formatted_phone_number = useMemo(() => {
    if (raw_phone_number.length <= 3) {
      return raw_phone_number;
    }

    if (raw_phone_number.length <= 7) {
      return `${raw_phone_number.slice(0, 3)}-${raw_phone_number.slice(3)}`;
    }

    return `${raw_phone_number.slice(0, 3)}-${raw_phone_number.slice(3, 7)}-${raw_phone_number.slice(7)}`;
  }, [raw_phone_number]);

  /**
   * 키패드 입력을 처리합니다. 숫자 외 문자는 전화번호 입력에서 제외합니다.
   */
  const handle_keypad_click = (key_value: string) => {
    if (!/^\d$/.test(key_value)) {
      return;
    }

    if (raw_phone_number.length >= max_phone_length) {
      return;
    }

    set_raw_phone_number((prev_phone_number) => `${prev_phone_number}${key_value}`);
  };

  /**
   * 마지막 입력 한 글자를 삭제합니다.
   */
  const handle_delete_click = () => {
    set_raw_phone_number((prev_phone_number) => prev_phone_number.slice(0, -1));
  };

  /**
   * 전화번호 형식을 검증하고 사용자에게 결과를 안내합니다.
   */
  const handle_submit_click = async () => {
    const is_valid_phone_number = /^010\d{8}$/.test(raw_phone_number);

    if (!is_valid_phone_number) {
      window.alert("유효한 전화번호를 입력해주세요. (예: 01012345678)");
      return;
    }

    try {
      set_is_submitting(true);
      set_submit_result_message("");
      set_submit_result_tone("info");

      const webhook_response = await fetch(make_webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contact: formatted_phone_number,
        }),
      });

      if (!webhook_response.ok) {
        console.error("Webhook 전송 실패", {
          status_code: webhook_response.status,
          status_text: webhook_response.statusText,
        });
        set_submit_result_tone("error");
        set_submit_result_message("요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      /**
       * Make 응답(JSON/텍스트)을 안전하게 처리하고 등록 완료 여부를 판단합니다.
       */
      const response_text = await webhook_response.text();
      const response_content_type = webhook_response.headers.get("content-type") || "";
      const is_json_response = response_content_type.includes("application/json");
      let parsed_response: make_webhook_response = {};

      if (response_text && (is_json_response || is_json_like_text(response_text))) {
        try {
          parsed_response = JSON.parse(response_text) as make_webhook_response;
        } catch (parse_error) {
          console.error("Webhook 응답 JSON 파싱 실패", parse_error);
        }
      }

      const normalized_response_text = response_text.trim().toLowerCase();
      const is_acknowledged_text_response =
        normalized_response_text === "accepted" ||
        normalized_response_text === "ok" ||
        normalized_response_text === "success";
      const is_registration_completed =
        (parsed_response.success === true && parsed_response.code === "REGISTERED") ||
        is_acknowledged_text_response;

      if (is_registration_completed) {
        /**
         * Step3에서 사용할 연락처를 임시 저장한 뒤 음성 테스트 화면으로 이동합니다.
         */
        localStorage.setItem("ai_interview_contact", formatted_phone_number);
        set_submit_result_tone("success");
        set_submit_result_message("등록 완료");
        setTimeout(() => {
          router.push("/mic-test");
        }, 600);
        return;
      }

      set_submit_result_tone("info");
      set_submit_result_message("요청이 접수되었습니다. 잠시 후 다시 확인해주세요.");
    } catch (error) {
      console.error("Webhook 요청 중 예외 발생", error);
      set_submit_result_tone("error");
      set_submit_result_message("일시적인 오류가 발생했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    } finally {
      set_is_submitting(false);
    }
  };

  const is_submit_enabled = /^010\d{8}$/.test(raw_phone_number) && !is_submitting;

  return (
    <div className="min-h-screen bg-[#f2f3f5] px-4 py-6">
      <main className="mx-auto w-full max-w-[860px] rounded-3xl bg-[#f8f9fb] p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:p-8">
        <section className="mb-6 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-[#101828]">AI 면접 프로그램</h1>
          <p className="mt-3 text-xl font-medium text-[#8b9097]">전화번호를 입력해주세요.</p>
          <p className="mt-1 text-xl font-medium text-[#8b9097]">입력 후 확인 버튼을 눌러주세요.</p>
        </section>

        <section className="rounded-2xl bg-[#eceef1] px-5 py-6 text-center">
          <p className={`text-4xl font-bold ${raw_phone_number ? "text-[#4a4f57]" : "text-[#adb2ba]"}`}>
            {raw_phone_number ? formatted_phone_number : "여기에 번호가 표시됩니다"}
          </p>
          {submit_result_message && (
            <p
              className={`mt-3 text-xl font-bold ${
                submit_result_tone === "success"
                  ? "text-[#16a34a]"
                  : submit_result_tone === "error"
                    ? "text-[#dc2626]"
                    : "text-[#4b5563]"
              }`}
            >
              {submit_result_message}
            </p>
          )}
        </section>

        <section className="mt-6 grid grid-cols-3 gap-4">
          {keypad_values.map((key_value) => (
            <button
              type="button"
              key={key_value}
              onClick={() => handle_keypad_click(key_value)}
              disabled={is_submitting}
              className="h-[88px] rounded-2xl bg-[#4f7de8] text-5xl font-bold text-white shadow-[0_6px_14px_rgba(79,125,232,0.35)] transition hover:bg-[#4673db] active:scale-[0.99]"
            >
              {key_value}
            </button>
          ))}
        </section>

        <section className="mt-5">
          <button
            type="button"
            onClick={handle_delete_click}
            disabled={is_submitting}
            className="h-[88px] w-full max-w-[270px] rounded-2xl bg-[#e55349] text-4xl font-bold text-white shadow-[0_6px_14px_rgba(229,83,73,0.35)] transition hover:bg-[#d84940] active:scale-[0.99]"
          >
            지우기
          </button>
        </section>

        <section className="mt-5">
          <button
            type="button"
            onClick={handle_submit_click}
            disabled={!is_submit_enabled}
            className="h-[60px] w-full rounded-2xl bg-[#65c569] text-4xl font-bold text-white shadow-[0_6px_14px_rgba(101,197,105,0.35)] transition enabled:hover:bg-[#57b95b] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {is_submitting ? "전송 중..." : "확인"}
          </button>
        </section>
      </main>
    </div>
  );
}
