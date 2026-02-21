"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const mic_record_duration_ms = 5000;
type mic_test_message_tone = "success" | "error" | "info";

interface whisper_test_response {
  success?: boolean;
  transcript?: string;
  message?: string;
}

interface speech_recognition_result_unit {
  transcript: string;
}

interface speech_recognition_result_group {
  0: speech_recognition_result_unit;
  isFinal: boolean;
}

interface speech_recognition_event_payload extends Event {
  resultIndex: number;
  results: ArrayLike<speech_recognition_result_group>;
}

interface speech_recognition_instance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event_item: Event) => void) | null;
  onerror: ((event_item: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type speech_recognition_constructor = new () => speech_recognition_instance;

/**
 * 브라우저 환경에서 사용 가능한 오디오 MIME 타입을 결정합니다.
 */
const get_supported_audio_mime_type = () => {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }

  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }

  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4";
  }

  return "";
};

/**
 * 전달된 미디어 스트림의 트랙을 모두 종료합니다.
 */
const stop_stream_tracks = (stream: MediaStream | null) => {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track_item) => {
    track_item.stop();
  });
};

/**
 * 음성 인식 결과 텍스트를 화면 표시용으로 정리합니다.
 */
const normalize_recognized_text = (input_text: string) => {
  return input_text.trim().replace(/\s+/g, " ");
};

/**
 * Step3 음성 테스트 화면을 렌더링합니다.
 */
export default function MicTestPage() {
  const router = useRouter();
  const active_stream_ref = useRef<MediaStream | null>(null);
  const media_recorder_ref = useRef<MediaRecorder | null>(null);
  const stop_button_unlock_timer_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveform_canvas_ref = useRef<HTMLCanvasElement | null>(null);
  const audio_context_ref = useRef<AudioContext | null>(null);
  const analyser_node_ref = useRef<AnalyserNode | null>(null);
  const media_source_ref = useRef<MediaStreamAudioSourceNode | null>(null);
  const waveform_animation_frame_ref = useRef<number | null>(null);
  const speech_recognition_ref = useRef<speech_recognition_instance | null>(null);
  const speech_transcript_ref = useRef("");

  const [saved_contact, set_saved_contact] = useState("");
  const [is_requesting_permission, set_is_requesting_permission] = useState(false);
  const [is_recording, set_is_recording] = useState(false);
  const [is_converting, set_is_converting] = useState(false);
  const [has_conversion_success, set_has_conversion_success] = useState(false);
  const [recorded_audio_url, set_recorded_audio_url] = useState("");
  const [recognized_text, set_recognized_text] = useState("");
  const [is_stop_enabled, set_is_stop_enabled] = useState(false);
  const [test_message, set_test_message] = useState("");
  const [test_message_tone, set_test_message_tone] = useState<mic_test_message_tone>("info");

  /**
   * 웨이브 시각화 리소스를 안전하게 정리합니다.
   */
  const stop_waveform_visualizer = () => {
    if (waveform_animation_frame_ref.current) {
      cancelAnimationFrame(waveform_animation_frame_ref.current);
      waveform_animation_frame_ref.current = null;
    }

    if (media_source_ref.current) {
      media_source_ref.current.disconnect();
      media_source_ref.current = null;
    }

    if (analyser_node_ref.current) {
      analyser_node_ref.current.disconnect();
      analyser_node_ref.current = null;
    }

    if (audio_context_ref.current) {
      audio_context_ref.current.close().catch((close_error) => {
        console.error("오디오 컨텍스트 종료 실패", close_error);
      });
      audio_context_ref.current = null;
    }
  };

  /**
   * 현재 입력 음성을 캔버스 파형으로 렌더링합니다.
   */
  const start_waveform_visualizer = (audio_stream: MediaStream) => {
    stop_waveform_visualizer();

    const canvas_element = waveform_canvas_ref.current;

    if (!canvas_element) {
      return;
    }

    const audio_context = new AudioContext();
    const analyser_node = audio_context.createAnalyser();
    const media_source = audio_context.createMediaStreamSource(audio_stream);
    analyser_node.fftSize = 2048;
    analyser_node.smoothingTimeConstant = 0.85;
    media_source.connect(analyser_node);

    audio_context_ref.current = audio_context;
    analyser_node_ref.current = analyser_node;
    media_source_ref.current = media_source;

    const canvas_context = canvas_element.getContext("2d");

    if (!canvas_context) {
      return;
    }

    const draw_waveform = () => {
      const current_canvas = waveform_canvas_ref.current;

      if (!current_canvas || !analyser_node_ref.current) {
        return;
      }

      const canvas_width = current_canvas.clientWidth;
      const canvas_height = current_canvas.clientHeight;

      if (current_canvas.width !== canvas_width) {
        current_canvas.width = canvas_width;
      }

      if (current_canvas.height !== canvas_height) {
        current_canvas.height = canvas_height;
      }

      const data_length = analyser_node_ref.current.fftSize;
      const time_domain_data = new Uint8Array(data_length);
      analyser_node_ref.current.getByteTimeDomainData(time_domain_data);

      canvas_context.clearRect(0, 0, canvas_width, canvas_height);
      canvas_context.fillStyle = "#f8fafc";
      canvas_context.fillRect(0, 0, canvas_width, canvas_height);
      canvas_context.lineWidth = 2;
      canvas_context.strokeStyle = "#4f7de8";
      canvas_context.beginPath();

      const slice_width = canvas_width / data_length;
      let x_axis = 0;

      for (let index = 0; index < data_length; index += 1) {
        const value = time_domain_data[index] / 128.0;
        const y_axis = (value * canvas_height) / 2;

        if (index === 0) {
          canvas_context.moveTo(x_axis, y_axis);
        } else {
          canvas_context.lineTo(x_axis, y_axis);
        }

        x_axis += slice_width;
      }

      canvas_context.lineTo(canvas_width, canvas_height / 2);
      canvas_context.stroke();

      waveform_animation_frame_ref.current = requestAnimationFrame(draw_waveform);
    };

    draw_waveform();
  };

  /**
   * 브라우저 SpeechRecognition 객체를 가져옵니다.
   */
  const get_speech_recognition_constructor = () => {
    const speech_window = window as Window & {
      SpeechRecognition?: speech_recognition_constructor;
      webkitSpeechRecognition?: speech_recognition_constructor;
    };

    return speech_window.SpeechRecognition || speech_window.webkitSpeechRecognition || null;
  };

  /**
   * 브라우저 음성 인식을 시작해 실시간 발화 텍스트를 수집합니다.
   */
  const start_speech_recognition = () => {
    const recognition_constructor = get_speech_recognition_constructor();

    if (!recognition_constructor) {
      return;
    }

    const recognition_instance = new recognition_constructor();
    recognition_instance.lang = "ko-KR";
    recognition_instance.interimResults = true;
    recognition_instance.continuous = true;

    recognition_instance.onresult = (event_item) => {
      const speech_event = event_item as speech_recognition_event_payload;
      let merged_text = speech_transcript_ref.current;

      for (let index = speech_event.resultIndex; index < speech_event.results.length; index += 1) {
        const result_group = speech_event.results[index];
        const current_text = normalize_recognized_text(result_group?.[0]?.transcript || "");

        if (!current_text || !result_group?.isFinal) {
          continue;
        }

        merged_text = `${merged_text} ${current_text}`.trim();
      }

      speech_transcript_ref.current = merged_text;

      if (merged_text) {
        set_recognized_text(merged_text);
      }
    };

    recognition_instance.onerror = (event_item) => {
      console.error("브라우저 음성 인식 실패", event_item);
    };

    recognition_instance.onend = () => {
      speech_recognition_ref.current = null;
    };

    try {
      recognition_instance.start();
      speech_recognition_ref.current = recognition_instance;
    } catch (error) {
      console.error("브라우저 음성 인식 시작 실패", error);
    }
  };

  /**
   * 브라우저 음성 인식을 종료합니다.
   */
  const stop_speech_recognition = () => {
    if (!speech_recognition_ref.current) {
      return;
    }

    try {
      speech_recognition_ref.current.stop();
    } catch (error) {
      console.error("브라우저 음성 인식 종료 실패", error);
    } finally {
      speech_recognition_ref.current = null;
    }
  };

  /**
   * 페이지 최초 진입 시 Step2에서 저장한 연락처를 확인합니다.
   */
  useEffect(() => {
    const stored_contact = localStorage.getItem("ai_interview_contact");

    if (!stored_contact) {
      set_test_message_tone("error");
      set_test_message("연락처 정보가 없습니다. 첫 화면에서 다시 진행해주세요.");
      return;
    }

    set_saved_contact(stored_contact);
  }, []);

  /**
   * 페이지 종료 시 녹음 관련 리소스를 정리합니다.
   */
  useEffect(() => {
    return () => {
      if (stop_button_unlock_timer_ref.current) {
        clearTimeout(stop_button_unlock_timer_ref.current);
      }

      stop_stream_tracks(active_stream_ref.current);
      stop_waveform_visualizer();
      stop_speech_recognition();

      if (recorded_audio_url) {
        URL.revokeObjectURL(recorded_audio_url);
      }
    };
  }, [recorded_audio_url]);

  /**
   * 마이크 권한 요청만 먼저 수행하고 결과를 화면에 표시합니다.
   */
  const handle_request_permission_click = async () => {
    if (is_requesting_permission) {
      return;
    }

    set_is_requesting_permission(true);
    set_test_message("");
    set_test_message_tone("info");

    try {
      const permission_stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stop_stream_tracks(permission_stream);
      set_test_message_tone("info");
      set_test_message("마이크 권한이 확인되었습니다. 테스트 녹음을 진행해주세요.");
    } catch (error) {
      console.error("마이크 권한 요청 실패", error);
      set_test_message_tone("error");
      set_test_message("마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 허용 후 재시도해주세요.");
    } finally {
      set_is_requesting_permission(false);
    }
  };

  /**
   * 녹음된 오디오를 서버로 전달해 변환 결과(성공/실패)를 받습니다.
   */
  const convert_recorded_audio = async (audio_blob: Blob) => {
    set_is_converting(true);

    try {
      const form_data = new FormData();
      const audio_file = new File([audio_blob], "mic-test.webm", {
        type: audio_blob.type || "audio/webm",
      });

      form_data.append("audio_file", audio_file);

      const conversion_response = await fetch("/api/whisper-test", {
        method: "POST",
        body: form_data,
      });

      if (!conversion_response.ok) {
        console.error("음성 변환 API 실패", {
          status_code: conversion_response.status,
          status_text: conversion_response.statusText,
        });
        set_has_conversion_success(false);
        set_test_message_tone("error");
        set_test_message("음성 변환 중 문제가 발생했습니다. 재시도해주세요.");
        return;
      }

      const response_data = (await conversion_response.json()) as whisper_test_response;
      const is_conversion_success = response_data.success === true;

      if (!is_conversion_success) {
        set_has_conversion_success(false);
        set_recognized_text("");
        set_test_message_tone("error");
        set_test_message(response_data.message || "음성 인식에 실패했습니다. 천천히 다시 말해보세요.");
        return;
      }

      const normalized_transcript = normalize_recognized_text(response_data.transcript || "");
      const browser_transcript = normalize_recognized_text(speech_transcript_ref.current);
      const final_transcript = browser_transcript || normalized_transcript;
      set_has_conversion_success(true);
      set_recognized_text(final_transcript);
      set_test_message_tone("success");
      set_test_message("마이크 테스트 문장이 정상적으로 인식되었습니다.");
    } catch (error) {
      console.error("음성 변환 요청 예외", error);
      set_has_conversion_success(false);
      set_test_message_tone("error");
      set_test_message("일시적인 오류가 발생했습니다. 네트워크 상태를 확인한 뒤 재시도해주세요.");
    } finally {
      set_is_converting(false);
    }
  };

  /**
   * 녹음을 시작하고 5초 이후 수동 종료를 허용합니다.
   */
  const handle_start_recording_click = async () => {
    if (is_recording || is_converting) {
      return;
    }

    set_has_conversion_success(false);
    set_recognized_text("");
    speech_transcript_ref.current = "";
    set_is_stop_enabled(false);
    set_test_message_tone("info");
    set_test_message("녹음을 시작했습니다. 5초 후 종료 버튼이 활성화됩니다.");

    try {
      const audio_stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime_type = get_supported_audio_mime_type();
      const recorder = mime_type
        ? new MediaRecorder(audio_stream, { mimeType: mime_type })
        : new MediaRecorder(audio_stream);

      active_stream_ref.current = audio_stream;
      media_recorder_ref.current = recorder;
      start_waveform_visualizer(audio_stream);
      start_speech_recognition();

      const audio_chunks: Blob[] = [];
      recorder.ondataavailable = (event_item: BlobEvent) => {
        if (event_item.data.size > 0) {
          audio_chunks.push(event_item.data);
        }
      };

      recorder.onstop = async () => {
        set_is_recording(false);
        set_is_stop_enabled(false);

        if (stop_button_unlock_timer_ref.current) {
          clearTimeout(stop_button_unlock_timer_ref.current);
          stop_button_unlock_timer_ref.current = null;
        }

        const output_blob = new Blob(audio_chunks, { type: mime_type || "audio/webm" });

        set_recorded_audio_url((prev_url) => {
          if (prev_url) {
            URL.revokeObjectURL(prev_url);
          }
          return URL.createObjectURL(output_blob);
        });

        stop_stream_tracks(active_stream_ref.current);
        active_stream_ref.current = null;
        media_recorder_ref.current = null;
        stop_waveform_visualizer();
        stop_speech_recognition();

        await convert_recorded_audio(output_blob);
      };

      recorder.start();
      set_is_recording(true);

      if (stop_button_unlock_timer_ref.current) {
        clearTimeout(stop_button_unlock_timer_ref.current);
      }

      stop_button_unlock_timer_ref.current = setTimeout(() => {
        set_is_stop_enabled(true);
        set_test_message_tone("info");
        set_test_message('녹음 완료! 아래 버튼을 눌러 종료하세요.');
      }, mic_record_duration_ms);
    } catch (error) {
      console.error("녹음 시작 실패", error);
      stop_stream_tracks(active_stream_ref.current);
      active_stream_ref.current = null;
      media_recorder_ref.current = null;
      stop_waveform_visualizer();
      stop_speech_recognition();
      set_is_recording(false);
      set_is_stop_enabled(false);
      set_test_message_tone("error");
      set_test_message("녹음을 시작할 수 없습니다. 마이크 권한과 장치 연결 상태를 확인해주세요.");
    }
  };

  /**
   * 5초가 지난 뒤 사용자가 녹음을 수동 종료합니다.
   */
  const handle_stop_recording_click = () => {
    if (!is_recording || !is_stop_enabled) {
      return;
    }

    const recorder = media_recorder_ref.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    if (stop_button_unlock_timer_ref.current) {
      clearTimeout(stop_button_unlock_timer_ref.current);
      stop_button_unlock_timer_ref.current = null;
    }

    set_test_message_tone("info");
    set_test_message("녹음을 종료했습니다. 음성 인식 결과를 확인 중입니다.");
    recorder.stop();
  };

  /**
   * 재시도 시 이전 결과를 초기화합니다.
   */
  const handle_retry_click = () => {
    set_has_conversion_success(false);
    set_recognized_text("");
    speech_transcript_ref.current = "";
    stop_speech_recognition();
    set_is_stop_enabled(false);
    set_test_message_tone("info");
    set_test_message("재시도를 준비했습니다. 다시 녹음을 시작해주세요.");
  };

  /**
   * 다음 단계 이동을 처리합니다.
   */
  const handle_next_click = () => {
    if (!has_conversion_success) {
      return;
    }

    router.push("/pre-check");
  };

  const is_next_enabled = useMemo(() => {
    return has_conversion_success && !is_recording && !is_converting;
  }, [has_conversion_success, is_recording, is_converting]);

  return (
    <div className="min-h-screen bg-[#f2f3f5] px-4 py-6">
      <main className="mx-auto w-full max-w-[860px] rounded-3xl bg-[#f8f9fb] p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:p-8">
        <section className="mb-6 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-[#101828]">음성 테스트</h1>
          <p className="mt-3 text-xl font-medium text-[#8b9097]">
            마이크 권한을 허용하고 5초 테스트 녹음을 진행해주세요.
          </p>
          <p className="mt-1 text-base text-[#8b9097]">연락처: {saved_contact || "미확인"}</p>
        </section>

        <section className="rounded-2xl bg-[#eceef1] px-5 py-6 text-center">
          <p className="text-lg font-semibold text-[#4a4f57]">상태</p>
          <p
            className={`mt-2 text-xl font-bold ${
              test_message_tone === "success"
                ? "text-[#16a34a]"
                : test_message_tone === "error"
                  ? "text-[#dc2626]"
                  : "text-[#4b5563]"
            }`}
          >
            {test_message || "아직 테스트를 시작하지 않았습니다."}
          </p>
        </section>

        <section className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handle_request_permission_click}
            disabled={is_requesting_permission || is_recording || is_converting}
            className="h-[56px] min-w-[180px] rounded-2xl bg-[#4f7de8] px-6 text-xl font-bold text-white shadow-[0_6px_14px_rgba(79,125,232,0.35)] transition enabled:hover:bg-[#4673db] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {is_requesting_permission ? "권한 확인 중..." : "마이크 권한 확인"}
          </button>

          <button
            type="button"
            onClick={handle_start_recording_click}
            disabled={is_requesting_permission || is_recording || is_converting}
            className="h-[56px] min-w-[180px] rounded-2xl bg-[#65c569] px-6 text-xl font-bold text-white shadow-[0_6px_14px_rgba(101,197,105,0.35)] transition enabled:hover:bg-[#57b95b] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {is_converting ? "변환 중..." : "녹음 시작"}
          </button>

          {is_recording && is_stop_enabled && (
            <button
              type="button"
              onClick={handle_stop_recording_click}
              disabled={is_converting}
              className="h-[56px] min-w-[180px] rounded-2xl bg-[#f59e0b] px-6 text-xl font-bold text-white shadow-[0_6px_14px_rgba(245,158,11,0.35)] transition enabled:hover:bg-[#d68a09] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              녹음 종료
            </button>
          )}

          <button
            type="button"
            onClick={handle_retry_click}
            disabled={is_recording || is_converting}
            className="h-[56px] min-w-[180px] rounded-2xl bg-[#e55349] px-6 text-xl font-bold text-white shadow-[0_6px_14px_rgba(229,83,73,0.35)] transition enabled:hover:bg-[#d84940] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            재시도
          </button>
        </section>

        <section className="mt-4 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-lg font-semibold text-[#101828]">실시간 음성 웨이브</p>
          <canvas
            ref={waveform_canvas_ref}
            className="mt-3 h-[120px] w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc]"
          />
          <p className="mt-2 text-sm text-[#8b9097]">
            {is_recording
              ? "녹음 중인 입력 음성을 실시간으로 표시하고 있습니다."
              : "녹음을 시작하면 파형이 실시간으로 표시됩니다."}
          </p>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-lg font-semibold text-[#101828]">녹음 결과 미리듣기</p>
          {recorded_audio_url ? (
            <audio className="mt-3 w-full" controls src={recorded_audio_url}>
              브라우저가 audio 태그를 지원하지 않습니다.
            </audio>
          ) : (
            <p className="mt-3 text-[#8b9097]">아직 녹음 파일이 없습니다.</p>
          )}
        </section>

        <section className="mt-4 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-lg font-semibold text-[#101828]">음성 인식 결과</p>
          {has_conversion_success && recognized_text && (
            <p className="mt-3 rounded-xl bg-[#ecfdf3] px-3 py-2 text-sm font-medium text-[#166534]">
              마이크 테스트 문장이 정상적으로 인식되었습니다.
            </p>
          )}
          <p className="mt-3 whitespace-pre-wrap text-[#4a4f57]">
            {recognized_text ? `사용자 발화: "${recognized_text}"` : "인식된 텍스트가 없습니다."}
          </p>
        </section>

        <section className="mt-6">
          <button
            type="button"
            onClick={handle_next_click}
            disabled={!is_next_enabled}
            className="h-[60px] w-full rounded-2xl bg-[#111827] text-2xl font-bold text-white shadow-[0_6px_14px_rgba(17,24,39,0.35)] transition enabled:hover:bg-[#1f2937] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            다음 단계로 이동
          </button>
        </section>
      </main>
    </div>
  );
}
