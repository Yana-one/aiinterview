import OpenAI from "openai";
import { NextResponse } from "next/server";

const default_assistant_id = "asst_uNmgpeU63rbYhxiDQ8GN7RNa";
export const runtime = "nodejs";

interface turn_request_payload {
  thread_id?: string;
  answer_text?: string;
  question_index?: number;
}

interface interview_turn_response {
  success: boolean;
  question_text: string;
  message: string;
}

/**
 * OpenAI 예외 객체에서 디버깅 가능한 메시지를 추출합니다.
 */
const get_openai_error_message = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "알 수 없는 서버 오류";
};

/**
 * Assistant 메시지 배열에서 최신 텍스트 메시지를 추출합니다.
 */
const extract_assistant_text = (messages_data: unknown) => {
  if (!Array.isArray(messages_data)) {
    return "";
  }

  const assistant_message = messages_data.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const maybe_item = item as { role?: string };
    return maybe_item.role === "assistant";
  });

  if (!assistant_message || typeof assistant_message !== "object") {
    return "";
  }

  const message_content = (assistant_message as { content?: unknown }).content;

  if (!Array.isArray(message_content)) {
    return "";
  }

  const text_part = message_content.find((content_item) => {
    if (!content_item || typeof content_item !== "object") {
      return false;
    }

    const maybe_content = content_item as { type?: string };
    return maybe_content.type === "text";
  });

  if (!text_part || typeof text_part !== "object") {
    return "";
  }

  const value_text = (text_part as { text?: { value?: string } }).text?.value;

  if (!value_text || typeof value_text !== "string") {
    return "";
  }

  return value_text.trim();
};

/**
 * 사용자 답변을 Assistant Thread에 전달하고 다음 질문을 생성합니다.
 */
export async function POST(request: Request) {
  try {
    const openai_api_key = process.env.OPENAI_API_KEY;
    const assistant_id = process.env.OPENAI_ASSISTANT_ID || default_assistant_id;

    if (!openai_api_key || !assistant_id) {
      return NextResponse.json(
        {
          success: false,
          question_text: "",
          message: "OpenAI 설정이 누락되었습니다.",
        } as interview_turn_response,
        { status: 500 },
      );
    }

    const request_body = (await request.json().catch(() => ({}))) as turn_request_payload;
    const thread_id = (request_body.thread_id || "").trim();
    const answer_text = (request_body.answer_text || "").trim();
    const question_index = Number(request_body.question_index || 1);

    if (!thread_id || !answer_text) {
      return NextResponse.json(
        {
          success: false,
          question_text: "",
          message: "thread_id 또는 answer_text가 누락되었습니다.",
        } as interview_turn_response,
        { status: 400 },
      );
    }

    const openai_client = new OpenAI({ apiKey: openai_api_key });

    await openai_client.beta.threads.messages.create(thread_id, {
      role: "user",
      content: `지원자 답변(${question_index}번 질문): ${answer_text}`,
    });

    const run = await openai_client.beta.threads.runs.createAndPoll(thread_id, {
      assistant_id,
      tool_choice: "none",
      additional_instructions:
        "당신은 한국어 AI 면접관입니다. 답변을 짧게 내부 평가하고, 바로 다음 질문 1개만 한국어로 제시하세요. 피드백 문장이나 번호 없이 질문만 출력하세요.",
    });

    if (run.status !== "completed") {
      return NextResponse.json(
        {
          success: false,
          question_text: "",
          message: `다음 질문 생성 실패(run_status: ${run.status}${run.last_error?.message ? `, detail: ${run.last_error.message}` : ""})`,
        } as interview_turn_response,
        { status: 500 },
      );
    }

    const messages_response = await openai_client.beta.threads.messages.list(thread_id, {
      order: "desc",
      limit: 20,
    });
    const question_text = extract_assistant_text(messages_response.data);

    if (!question_text) {
      return NextResponse.json(
        {
          success: false,
          question_text: "",
          message: "Assistant 응답에서 다음 질문을 찾을 수 없습니다.",
        } as interview_turn_response,
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        question_text,
        message: "다음 질문 생성 완료",
      } as interview_turn_response,
      { status: 200 },
    );
  } catch (error) {
    console.error("다음 질문 생성 예외", error);

    return NextResponse.json(
      {
        success: false,
        question_text: "",
        message: `다음 질문 생성 중 문제가 발생했습니다. (${get_openai_error_message(error)})`,
      } as interview_turn_response,
      { status: 500 },
    );
  }
}
