import OpenAI from "openai";
import { NextResponse } from "next/server";

const default_assistant_id = "asst_uNmgpeU63rbYhxiDQ8GN7RNa";
export const runtime = "nodejs";

interface session_request_payload {
  contact?: string | null;
}

interface interview_session_response {
  success: boolean;
  thread_id: string;
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
 * Step5 면접 세션을 생성하고 첫 질문을 반환합니다.
 */
export async function POST(request: Request) {
  try {
    const openai_api_key = process.env.OPENAI_API_KEY;
    const assistant_id = process.env.OPENAI_ASSISTANT_ID || default_assistant_id;

    if (!openai_api_key) {
      return NextResponse.json(
        {
          success: false,
          thread_id: "",
          question_text: "",
          message: "OPENAI_API_KEY가 설정되지 않았습니다.",
        } as interview_session_response,
        { status: 500 },
      );
    }

    if (!assistant_id) {
      return NextResponse.json(
        {
          success: false,
          thread_id: "",
          question_text: "",
          message: "Assistant ID가 설정되지 않았습니다.",
        } as interview_session_response,
        { status: 500 },
      );
    }

    const request_body = (await request.json().catch(() => ({}))) as session_request_payload;
    const candidate_contact = (request_body.contact || "").trim();
    const openai_client = new OpenAI({ apiKey: openai_api_key });
    const thread = await openai_client.beta.threads.create();

    await openai_client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `면접을 시작해주세요. 지원자 연락처: ${candidate_contact || "미입력"}`,
    });

    const run = await openai_client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id,
      tool_choice: "none",
      additional_instructions:
        "당신은 한국어 AI 면접관입니다. 한 번에 질문 1개만, 1~2문장으로 간결하게 말하세요. 질문 텍스트에는 번호를 붙이지 마세요.",
    });

    if (run.status !== "completed") {
      return NextResponse.json(
        {
          success: false,
          thread_id: thread.id,
          question_text: "",
          message: `첫 질문 생성에 실패했습니다. (run_status: ${run.status}${run.last_error?.message ? `, detail: ${run.last_error.message}` : ""})`,
        } as interview_session_response,
        { status: 500 },
      );
    }

    const messages_response = await openai_client.beta.threads.messages.list(thread.id, {
      order: "desc",
      limit: 20,
    });

    const question_text = extract_assistant_text(messages_response.data);

    if (!question_text) {
      return NextResponse.json(
        {
          success: false,
          thread_id: thread.id,
          question_text: "",
          message: "Assistant 응답에서 질문 텍스트를 찾을 수 없습니다.",
        } as interview_session_response,
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        thread_id: thread.id,
        question_text,
        message: "면접 세션이 시작되었습니다.",
      } as interview_session_response,
      { status: 200 },
    );
  } catch (error) {
    console.error("면접 세션 생성 예외", error);

    return NextResponse.json(
      {
        success: false,
        thread_id: "",
        question_text: "",
        message: `면접 세션 생성 중 문제가 발생했습니다. (${get_openai_error_message(error)})`,
      } as interview_session_response,
      { status: 500 },
    );
  }
}
