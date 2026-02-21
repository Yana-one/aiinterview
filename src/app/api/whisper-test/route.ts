import { NextResponse } from "next/server";

const min_audio_file_size_bytes = 2048;

interface whisper_test_api_response {
  success: boolean;
  transcript: string;
  message: string;
}

/**
 * Step3 테스트용 음성 변환 API를 처리합니다.
 */
export async function POST(request: Request) {
  try {
    const form_data = await request.formData();
    const audio_file = form_data.get("audio_file");

    if (!(audio_file instanceof File)) {
      const invalid_file_response: whisper_test_api_response = {
        success: false,
        transcript: "",
        message: "오디오 파일을 찾을 수 없습니다. 다시 녹음 후 재시도해주세요.",
      };

      return NextResponse.json(invalid_file_response, { status: 400 });
    }

    if (audio_file.size < min_audio_file_size_bytes) {
      const too_short_response: whisper_test_api_response = {
        success: false,
        transcript: "",
        message: "음성이 너무 짧거나 작게 녹음되었습니다. 조금 더 크게 다시 말씀해주세요.",
      };

      return NextResponse.json(too_short_response, { status: 200 });
    }

    /**
     * 실제 Whisper 연동 전까지는 테스트용 인식 문구를 반환합니다.
     */
    const success_response: whisper_test_api_response = {
      success: true,
      transcript: "마이크 테스트 문장이 정상적으로 인식되었습니다.",
      message: "음성 인식 성공",
    };

    return NextResponse.json(success_response, { status: 200 });
  } catch (error) {
    console.error("whisper-test API 예외", error);

    const server_error_response: whisper_test_api_response = {
      success: false,
      transcript: "",
      message: "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    };

    return NextResponse.json(server_error_response, { status: 500 });
  }
}
