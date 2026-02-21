"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const total_question_count = 5;

type interview_phase =
  | "loading"
  | "question_playing"
  | "ready_to_answer"
  | "recording"
  | "submitting"
  | "finished"
  | "error";

interface interview_session_response {
  success?: boolean;
  thread_id?: string;
  question_text?: string;
  message?: string;
}

interface interview_turn_response {
  success?: boolean;
  question_text?: string;
  message?: string;
}

interface interview_webhook_response {
  success?: boolean;
  message?: string;
}

interface answer_log_item {
  id: number;
  question_text: string;
  answer_text: string;
  duration_sec: number;
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

interface speech_recognition_error_event_payload extends Event {
  error?: string;
  message?: string;
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
 * 초 단위를 mm:ss 포맷으로 변환합니다.
 */
const format_duration_text = (duration_sec: number) => {
  const safe_duration = Math.max(0, Math.floor(duration_sec));
  const minute_value = String(Math.floor(safe_duration / 60)).padStart(2, "0");
  const second_value = String(safe_duration % 60).padStart(2, "0");
  return `${minute_value}:${second_value}`;
};

/**
 * 인식 텍스트를 화면 표시용으로 정리합니다.
 */
const normalize_recognized_text = (input_text: string) => {
  return input_text.trim().replace(/\s+/g, " ");
};

/**
 * 답변 텍스트가 질문 재요청 의도인지 판별합니다.
 */
const is_question_replay_request_text = (input_text: string) => {
  const normalized_text = normalize_recognized_text(input_text).toLowerCase();

  if (!normalized_text) {
    return false;
  }

  const replay_request_patterns = ["다시 질문", "질문 다시", "다시 말해", "다시 해줘", "한 번 더", "못 들었"];
  return replay_request_patterns.some((pattern_text) => normalized_text.includes(pattern_text));
};

/**
 * 답변 로그를 웹훅 전송용 텍스트로 직렬화합니다.
 */
const build_interview_log_text = (answer_items: answer_log_item[]) => {
  return answer_items
    .map((answer_item) => `질문: ${answer_item.question_text}, 답변: ${answer_item.answer_text}`)
    .join(", ");
};

/**
 * 전화번호 문자열을 010-1234-5678 형식으로 정규화합니다.
 */
const normalize_contact_number = (input_text: string) => {
  const digits_only_text = input_text.replace(/\D/g, "");

  if (!/^010\d{8}$/.test(digits_only_text)) {
    return "";
  }

  return `${digits_only_text.slice(0, 3)}-${digits_only_text.slice(3, 7)}-${digits_only_text.slice(7)}`;
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
 * Step5 AI 면접 진행 화면을 렌더링합니다.
 */
export default function InterviewPage() {
  const active_stream_ref = useRef<MediaStream | null>(null);
  const media_recorder_ref = useRef<MediaRecorder | null>(null);
  const waveform_canvas_ref = useRef<HTMLCanvasElement | null>(null);
  const audio_context_ref = useRef<AudioContext | null>(null);
  const analyser_node_ref = useRef<AnalyserNode | null>(null);
  const media_source_ref = useRef<MediaStreamAudioSourceNode | null>(null);
  const waveform_animation_frame_ref = useRef<number | null>(null);
  const speech_recognition_ref = useRef<speech_recognition_instance | null>(null);
  const speech_transcript_ref = useRef("");
  const speech_preview_text_ref = useRef("");
  const recording_started_at_ms_ref = useRef<number | null>(null);
  const is_stopping_speech_recognition_ref = useRef(false);

  const [saved_contact, set_saved_contact] = useState("");
  const [phase, set_phase] = useState<interview_phase>("loading");
  const [status_message, set_status_message] = useState("면접 세션을 준비 중입니다.");
  const [thread_id, set_thread_id] = useState("");
  const [current_question_number, set_current_question_number] = useState(1);
  const [current_question_text, set_current_question_text] = useState("");
  const [latest_answer_text, set_latest_answer_text] = useState("");
  const [answer_log_items, set_answer_log_items] = useState<answer_log_item[]>([]);
  const [is_submitting_interview_log, set_is_submitting_interview_log] = useState(false);

  /**
   * 면접 데이터를 로컬 스토리지에 임시 캐시합니다.
   */
  useEffect(() => {
    if (!saved_contact) {
      return;
    }

    const interview_cache_payload = {
      contact: saved_contact,
      startedAt: new Date().toISOString(),
      qa: answer_log_items.map((item) => ({
        q: item.question_text,
        aText: item.answer_text,
        durationSec: item.duration_sec,
      })),
      language: "ko-KR",
    };

    localStorage.setItem("aiInterviewCache", JSON.stringify(interview_cache_payload));
    /**
     * 기존 키 오타(`ailnterviewCache`)를 사용하는 환경도 호환합니다.
     */
    localStorage.setItem("ailnterviewCache", JSON.stringify(interview_cache_payload));
  }, [answer_log_items, saved_contact]);

  /**
   * 웨이브 시각화 리소스를 정리합니다.
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
   * 실시간 파형을 캔버스에 렌더링합니다.
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
   * 브라우저 SpeechRecognition 생성자를 반환합니다.
   */
  const get_speech_recognition_constructor = () => {
    const speech_window = window as Window & {
      SpeechRecognition?: speech_recognition_constructor;
      webkitSpeechRecognition?: speech_recognition_constructor;
    };

    return speech_window.SpeechRecognition || speech_window.webkitSpeechRecognition || null;
  };

  /**
   * 브라우저 음성 인식을 시작합니다.
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
    is_stopping_speech_recognition_ref.current = false;

    recognition_instance.onresult = (event_item) => {
      const speech_event = event_item as speech_recognition_event_payload;
      let merged_final_text = speech_transcript_ref.current;
      const interim_text_chunks: string[] = [];

      for (let index = speech_event.resultIndex; index < speech_event.results.length; index += 1) {
        const result_group = speech_event.results[index];
        const current_text = normalize_recognized_text(result_group?.[0]?.transcript || "");

        if (!current_text) {
          continue;
        }

        if (result_group?.isFinal) {
          merged_final_text = `${merged_final_text} ${current_text}`.trim();
        } else {
          interim_text_chunks.push(current_text);
        }
      }

      const interim_preview_text = normalize_recognized_text(interim_text_chunks.join(" "));
      const merged_preview_text = normalize_recognized_text(`${merged_final_text} ${interim_preview_text}`);
      speech_transcript_ref.current = merged_final_text;
      speech_preview_text_ref.current = merged_preview_text;

      if (merged_preview_text) {
        set_latest_answer_text(merged_preview_text);
      }
    };

    recognition_instance.onerror = (event_item) => {
      const speech_error_event = event_item as speech_recognition_error_event_payload;
      const error_code = speech_error_event.error || "unknown";
      const error_message = speech_error_event.message || "";
      const is_expected_abort_error = is_stopping_speech_recognition_ref.current && error_code === "aborted";

      if (is_expected_abort_error) {
        return;
      }

      console.error("브라우저 음성 인식 실패", {
        error_code,
        error_message,
      });

      if (error_code === "not-allowed" || error_code === "service-not-allowed") {
        set_status_message("마이크 권한이 필요합니다. 브라우저 주소창의 권한 설정을 확인해주세요.");
      }
    };

    recognition_instance.onend = () => {
      is_stopping_speech_recognition_ref.current = false;
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
      is_stopping_speech_recognition_ref.current = true;
      speech_recognition_ref.current.stop();
    } catch (error) {
      console.error("브라우저 음성 인식 종료 실패", error);
      is_stopping_speech_recognition_ref.current = false;
    } finally {
      speech_recognition_ref.current = null;
    }
  };

  /**
   * 질문 음성을 재생합니다.
   */
  const speak_question = (question_text: string) => {
    if (!("speechSynthesis" in window)) {
      set_phase("ready_to_answer");
      set_status_message("질문 음성 재생을 건너뛰었습니다. 답변을 시작해주세요.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(question_text);
    utterance.lang = "ko-KR";
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      set_phase("ready_to_answer");
      set_status_message(
        "질문 음성 재생이 끝났습니다. 다시 듣고 싶으면 '질문 다시 해주세요'라고 말한 뒤 답변 종료를 눌러주세요.",
      );
    };

    utterance.onerror = (event_item) => {
      console.error("질문 음성 재생 실패", event_item);
      set_phase("ready_to_answer");
      set_status_message("질문 음성 재생에 문제가 있었습니다. 답변을 바로 시작할 수 있습니다.");
    };

    set_phase("question_playing");
    set_status_message("AI가 질문을 음성으로 전달하고 있습니다.");
    window.speechSynthesis.speak(utterance);
  };

  /**
   * 면접 세션을 생성하고 첫 질문을 요청합니다.
   */
  const start_interview_session = async () => {
    try {
      set_phase("loading");
      set_status_message("면접 세션을 준비 중입니다.");

      const session_response = await fetch("/api/interview/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contact: saved_contact || null,
        }),
      });

      if (!session_response.ok) {
        const session_error_data = (await session_response.json().catch(() => ({}))) as interview_session_response;
        set_phase("error");
        set_status_message(session_error_data.message || "면접 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      const session_data = (await session_response.json()) as interview_session_response;

      if (!session_data.success || !session_data.thread_id || !session_data.question_text) {
        set_phase("error");
        set_status_message(session_data.message || "면접 시작에 실패했습니다.");
        return;
      }

      set_thread_id(session_data.thread_id);
      set_current_question_text(session_data.question_text);
      speak_question(session_data.question_text);
    } catch (error) {
      console.error("면접 세션 시작 예외", error);
      set_phase("error");
      set_status_message("면접 세션 시작 중 문제가 발생했습니다. 네트워크를 확인해주세요.");
    }
  };

  /**
   * 첫 렌더링에서 연락처를 읽고 면접 세션을 시작합니다.
   */
  useEffect(() => {
    const stored_contact = localStorage.getItem("ai_interview_contact") || "";
    set_saved_contact(stored_contact);
  }, []);

  /**
   * 연락처가 준비되면 면접 세션 생성 요청을 시작합니다.
   */
  useEffect(() => {
    if (!saved_contact) {
      return;
    }

    start_interview_session();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved_contact]);

  /**
   * 페이지 이탈 시 음성 리소스를 정리합니다.
   */
  useEffect(() => {
    return () => {
      stop_stream_tracks(active_stream_ref.current);
      stop_waveform_visualizer();
      stop_speech_recognition();
      window.speechSynthesis.cancel();
    };
  }, []);

  /**
   * 답변 녹음을 시작합니다.
   */
  const handle_start_record_click = async () => {
    if (phase !== "ready_to_answer") {
      return;
    }

    try {
      speech_transcript_ref.current = "";
      speech_preview_text_ref.current = "";
      set_latest_answer_text("");
      set_status_message("답변 녹음 중입니다. 답변이 끝나면 종료 버튼을 눌러주세요.");

      const audio_stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(audio_stream);
      active_stream_ref.current = audio_stream;
      media_recorder_ref.current = recorder;
      recording_started_at_ms_ref.current = Date.now();

      recorder.onstop = async () => {
        stop_stream_tracks(active_stream_ref.current);
        active_stream_ref.current = null;
        media_recorder_ref.current = null;
        stop_waveform_visualizer();
        stop_speech_recognition();

        const duration_sec = Math.max(
          1,
          Math.round((Date.now() - (recording_started_at_ms_ref.current || Date.now())) / 1000),
        );
        /**
         * 브라우저가 마지막 final 이벤트를 늦게 주는 경우를 대비해
         * preview 텍스트를 보조 fallback으로 사용합니다.
         */
        const answer_text = normalize_recognized_text(
          speech_transcript_ref.current || speech_preview_text_ref.current,
        );
        const is_replay_request = is_question_replay_request_text(answer_text);

        if (is_replay_request) {
          set_phase("question_playing");
          set_status_message("질문을 다시 들려드릴게요. 음성 안내가 끝나면 다시 답변을 시작해주세요.");
          set_latest_answer_text("");
          speech_transcript_ref.current = "";
          speech_preview_text_ref.current = "";
          speak_question(current_question_text);
          return;
        }

        if (!answer_text) {
          set_phase("ready_to_answer");
          set_status_message("답변 인식 텍스트가 없습니다. 조금 더 크게 다시 말씀해주세요.");
          return;
        }

        set_latest_answer_text(answer_text);
        set_answer_log_items((prev_items) => [
          ...prev_items,
          {
            id: prev_items.length + 1,
            question_text: current_question_text,
            answer_text,
            duration_sec,
          },
        ]);

        const is_last_question = current_question_number >= total_question_count;

        if (is_last_question) {
          set_phase("finished");
          set_status_message("마지막 답변까지 완료되었습니다. 면접을 종료할 수 있습니다.");
          return;
        }

        if (!thread_id) {
          set_phase("error");
          set_status_message("면접 스레드 정보가 없어 다음 질문을 가져올 수 없습니다.");
          return;
        }

        try {
          set_phase("submitting");
          set_status_message("답변을 분석하고 다음 질문을 준비하고 있습니다.");

          const turn_response = await fetch("/api/interview/turn", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              thread_id,
              answer_text,
              question_index: current_question_number,
            }),
          });

          if (!turn_response.ok) {
            const turn_error_data = (await turn_response.json().catch(() => ({}))) as interview_turn_response;
            set_phase("error");
            set_status_message(turn_error_data.message || "다음 질문 생성에 실패했습니다. 네트워크 상태를 확인해주세요.");
            return;
          }

          const turn_data = (await turn_response.json()) as interview_turn_response;

          if (!turn_data.success || !turn_data.question_text) {
            set_phase("error");
            set_status_message(turn_data.message || "다음 질문을 생성할 수 없습니다.");
            return;
          }

          set_current_question_number((prev_value) => prev_value + 1);
          set_current_question_text(turn_data.question_text);
          speak_question(turn_data.question_text);
        } catch (error) {
          console.error("다음 질문 요청 예외", error);
          set_phase("error");
          set_status_message("다음 질문 요청 중 문제가 발생했습니다.");
        }
      };

      recorder.start();
      start_waveform_visualizer(audio_stream);
      start_speech_recognition();
      set_phase("recording");
    } catch (error) {
      console.error("답변 녹음 시작 실패", error);
      stop_stream_tracks(active_stream_ref.current);
      active_stream_ref.current = null;
      media_recorder_ref.current = null;
      set_phase("error");
      set_status_message("마이크를 시작할 수 없습니다. 권한과 장치 상태를 확인해주세요.");
    }
  };

  /**
   * 답변 녹음을 종료합니다.
   */
  const handle_stop_record_click = () => {
    if (phase !== "recording") {
      return;
    }

    const recorder = media_recorder_ref.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    set_status_message("녹음을 종료했습니다. 답변을 처리 중입니다.");
    recorder.stop();
  };

  /**
   * 누적 면접 로그를 Make 웹훅으로 전송하고 면접을 종료합니다.
   */
  const handle_finish_interview_click = async () => {
    if (is_submitting_interview_log) {
      return;
    }

    if (phase !== "finished") {
      set_status_message("모든 질문에 답변한 뒤 면접 종료를 진행해주세요.");
      return;
    }

    const interview_log_text = build_interview_log_text(answer_log_items);
    /**
     * 로컬 스토리지 캐시에서 연락처를 우선 조회하고, 없으면 화면 상태값을 보조로 사용합니다.
     */
    const cached_interview_text =
      localStorage.getItem("ailnterviewCache") || localStorage.getItem("aiInterviewCache") || "";
    let normalized_contact = "";

    if (cached_interview_text) {
      try {
        const parsed_cache = JSON.parse(cached_interview_text) as { contact?: string };
        normalized_contact = normalize_contact_number(parsed_cache.contact || "");
      } catch (parse_error) {
        console.error("면접 캐시 파싱 실패", parse_error);
      }
    }

    if (!normalized_contact) {
      normalized_contact = normalize_contact_number(saved_contact);
    }

    if (!normalized_contact) {
      const fallback_saved_contact = localStorage.getItem("ai_interview_contact") || "";
      normalized_contact = normalize_contact_number(fallback_saved_contact);
    }

    if (!interview_log_text) {
      set_status_message("전송할 면접 로그가 없습니다. 답변을 먼저 완료해주세요.");
      return;
    }

    /**
     * 면접 종료 전송 시 등록된 연락처가 없으면 사용자에게 재시도를 안내합니다.
     */
    if (!normalized_contact) {
      set_status_message("등록된 연락처를 확인할 수 없습니다. 처음 화면에서 다시 등록한 뒤 시도해주세요.");
      return;
    }

    try {
      set_is_submitting_interview_log(true);
      set_status_message("면접 내용을 전송하고 있습니다.");

      const webhook_response = await fetch("/api/interview/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          interviewlog: interview_log_text,
          contact: normalized_contact,
        }),
      });

      if (!webhook_response.ok) {
        const webhook_error_data = (await webhook_response.json().catch(() => ({}))) as interview_webhook_response;
        set_status_message(webhook_error_data.message || "면접 종료 전송에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      set_status_message("면접 종료가 완료되었습니다. 면접 내용 전송도 성공했습니다.");
    } catch (error) {
      console.error("면접 로그 전송 예외", error);
      set_status_message("면접 종료 처리 중 문제가 발생했습니다. 네트워크 상태를 확인해주세요.");
    } finally {
      set_is_submitting_interview_log(false);
    }
  };

  const can_start_record = phase === "ready_to_answer";
  const can_stop_record = phase === "recording";

  const record_button_label = useMemo(() => {
    if (phase === "question_playing" || phase === "loading" || phase === "submitting") {
      return "질문 재생 중";
    }

    if (phase === "recording") {
      return "녹음 중";
    }

    if (phase === "finished") {
      return "면접 완료";
    }

    return "답변 시작";
  }, [phase]);

  const record_button_class_name = useMemo(() => {
    if (phase === "recording") {
      return "h-[58px] w-full rounded-2xl bg-[#ef4444] text-xl font-bold text-white shadow-[0_6px_14px_rgba(239,68,68,0.35)] animate-pulse";
    }

    if (phase === "ready_to_answer") {
      return "h-[58px] w-full rounded-2xl bg-[#3b82f6] text-xl font-bold text-white shadow-[0_6px_14px_rgba(59,130,246,0.35)]";
    }

    return "h-[58px] w-full rounded-2xl bg-[#9ca3af] text-xl font-bold text-white opacity-80";
  }, [phase]);

  return (
    <div className="min-h-screen bg-[#f2f3f5] px-4 py-6">
      <main className="mx-auto w-full max-w-[980px] rounded-3xl bg-[#f8f9fb] p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:p-8">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
          <div>
            <p className="text-sm font-semibold text-[#4f7de8]">STEP 5</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#101828]">AI 면접 진행</h1>
            <p className="mt-1 text-sm text-[#8b9097]">질문은 음성으로만 제공됩니다. 안내 음성을 듣고 답변해주세요.</p>
            <p className="mt-1 text-sm text-[#8b9097]">연락처: {saved_contact || "미확인"}</p>
          </div>
          <div className="rounded-xl bg-[#eef2ff] px-4 py-2 text-sm font-semibold text-[#384b8f]">
            진행률 {Math.min(current_question_number, total_question_count)} / {total_question_count}
          </div>
        </section>

        <section className="mt-5 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-sm font-semibold text-[#4f7de8]">AI 음성 질문 안내</p>
          <div className="mt-3 rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-4">
            <p className="text-xl font-bold text-[#101828]">AI가 질문을 음성으로 전달합니다.</p>
            <p className="mt-2 text-sm text-[#6b7280]">
              질문 텍스트는 표시하지 않습니다. 음성을 들은 뒤 답변을 시작해주세요.
            </p>
            <p className="mt-3 text-sm font-semibold text-[#4b5563]">상태: {status_message}</p>
            {phase === "error" && (
              <button
                type="button"
                onClick={start_interview_session}
                className="mt-3 h-[42px] rounded-xl bg-[#4f7de8] px-4 text-sm font-bold text-white shadow-[0_6px_14px_rgba(79,125,232,0.35)]"
              >
                면접 세션 다시 시작
              </button>
            )}
          </div>
        </section>

        <section className="mt-5 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-lg font-semibold text-[#101828]">실시간 Waveform</p>
          <canvas
            ref={waveform_canvas_ref}
            className="mt-3 h-[130px] w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc]"
          />
          <p className="mt-2 text-sm text-[#8b9097]">
            {phase === "recording"
              ? "답변 입력 파형을 실시간으로 표시하고 있습니다."
              : "답변 녹음 시작 시 파형이 표시됩니다."}
          </p>
        </section>

        <section className="mt-5 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-lg font-semibold text-[#101828]">답변 컨트롤</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handle_start_record_click}
              disabled={!can_start_record}
              className={`${record_button_class_name} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {record_button_label}
            </button>

            <button
              type="button"
              onClick={handle_stop_record_click}
              disabled={!can_stop_record}
              className="h-[58px] rounded-2xl bg-[#f59e0b] text-lg font-bold text-white shadow-[0_6px_14px_rgba(245,158,11,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              답변 종료
            </button>
          </div>

          <div className="mt-4 rounded-xl bg-[#f3f4f6] px-4 py-3">
            <p className="text-sm text-[#4b5563]">
              질문을 다시 듣고 싶다면 녹음 중에 "질문 다시 해주세요"라고 말한 뒤 답변 종료 버튼을 눌러주세요.
            </p>
            <p className="text-sm font-semibold text-[#374151]">최근 인식 답변 텍스트</p>
            <p className="mt-1 text-sm text-[#4b5563]">
              {latest_answer_text || "아직 인식된 답변 텍스트가 없습니다."}
            </p>
          </div>
        </section>

        <section className="mt-5 rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-semibold text-[#101828]">답변 로그</p>
            <p className="text-sm text-[#8b9097]">누적 {answer_log_items.length}개</p>
          </div>

          <div className="mt-4 space-y-3">
            {answer_log_items.length > 0 ? (
              answer_log_items.map((item) => (
                <article key={item.id} className="rounded-xl border border-[#dde3ea] bg-[#fbfcfe] p-4">
                  <p className="text-sm font-semibold text-[#4f7de8]">답변 {item.id}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#374151]">{item.answer_text}</p>
                  <p className="mt-2 text-xs font-medium text-[#6b7280]">
                    답변 시간: {format_duration_text(item.duration_sec)}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm text-[#8b9097]">아직 저장된 답변 로그가 없습니다.</p>
            )}
          </div>
        </section>

        <section className="mt-6">
          <button
            type="button"
            onClick={handle_finish_interview_click}
            disabled={phase !== "finished" || is_submitting_interview_log}
            className="h-[58px] w-full rounded-2xl bg-[#e55349] text-xl font-bold text-white shadow-[0_6px_14px_rgba(229,83,73,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {is_submitting_interview_log ? "면접 내용 전송 중" : "면접 종료"}
          </button>
        </section>
      </main>
    </div>
  );
}
