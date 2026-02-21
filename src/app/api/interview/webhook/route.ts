import { NextResponse } from "next/server";

export const runtime = "nodejs";
const interview_webhook_url = "https://hook.us2.make.com/f7wugjosan22kcnycdiqg90ykuiqco6w";

interface webhook_request_payload {
  interviewlog?: string;
  contact?: string;
  phone?: string;
  contactNumber?: string;
}

interface webhook_response_payload {
  success: boolean;
  message: string;
}

/**
 * 면접 로그 텍스트를 Make 웹훅으로 전달합니다.
 */
export async function POST(request: Request) {
  try {
    const request_body = (await request.json().catch(() => ({}))) as webhook_request_payload;
    const interview_log_text = (request_body.interviewlog || "").trim();
    const candidate_contact = (
      request_body.contact ||
      request_body.phone ||
      request_body.contactNumber ||
      ""
    ).trim();

    if (!interview_log_text) {
      return NextResponse.json(
        {
          success: false,
          message: "interviewlog 값이 비어 있습니다.",
        } as webhook_response_payload,
        { status: 400 },
      );
    }

    if (!candidate_contact) {
      return NextResponse.json(
        {
          success: false,
          message: "contact 값이 비어 있습니다.",
        } as webhook_response_payload,
        { status: 400 },
      );
    }

    const webhook_response = await fetch(interview_webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        interviewlog: interview_log_text,
        contact: candidate_contact,
      }),
    });

    if (!webhook_response.ok) {
      const error_text = await webhook_response.text().catch(() => "");
      console.error("면접 웹훅 응답 실패", webhook_response.status, error_text);

      return NextResponse.json(
        {
          success: false,
          message: "면접 로그 전송에 실패했습니다. 잠시 후 다시 시도해주세요.",
        } as webhook_response_payload,
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "면접 로그 전송이 완료되었습니다.",
      } as webhook_response_payload,
      { status: 200 },
    );
  } catch (error) {
    console.error("면접 웹훅 전송 예외", error);

    return NextResponse.json(
      {
        success: false,
        message: "면접 로그 전송 중 문제가 발생했습니다.",
      } as webhook_response_payload,
      { status: 500 },
    );
  }
}
