"use client"

import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Play, Pause, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceToVideoOptions {
  language: string;
  videoStyle: 'modern' | 'cinematic' | 'energetic' | 'professional';
  duration: number;
  quality: '720p' | '1080p' | '4k';
}

interface VoiceToVideoResult {
  transcript: string;
  videoUrl: string;
  duration: number;
  language: string;
  /** Seconds from hitting Generate to the video being ready. */
  processingTime: number;
}

function VoiceToVideoPanel() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceToVideoResult | null>(null);
  const [options, setOptions] = useState<VoiceToVideoOptions>({
    language: 'en',
    videoStyle: 'cinematic',
    duration: 30,
    quality: '1080p',
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        } 
      });
      
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
        setAudioUrl(URL.createObjectURL(audioBlob));
        toast.success('Recording completed!');
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.success('Recording started...');
    } catch (error) {
      console.error('Error starting recording:', error);
      toast.error('Failed to start recording. Please check microphone permissions.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  }, [isRecording]);

  const processVoiceToVideo = useCallback(async () => {
    if (!audioBlob) {
      toast.error('Please record audio first');
      return;
    }

    setIsProcessing(true);
    setResult(null);

    const startedAt = Date.now();
    try {
      // Convert blob to base64 in chunks — String.fromCharCode(...bytes) blows
      // the argument limit on anything more than a short recording.
      const bytes = new Uint8Array(await audioBlob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const base64Audio = btoa(binary);

      const response = await fetch('/api/voice-to-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64Audio, options }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to process voice-to-video');
      }

      const { videoId, transcript } = data.data;
      toast.success('Transcribed — generating your video…');

      // Generation is async now (same pipeline as the AI Studio): poll for it.
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(`/api/ai/jobs/${videoId}`);
        if (!statusRes.ok) continue;
        const job = await statusRes.json();

        if (job.status === 'COMPLETED' && job.videoUrl) {
          setResult({
            transcript,
            videoUrl: job.videoUrl,
            duration: data.data.duration,
            language: data.data.language,
            processingTime: Math.round((Date.now() - startedAt) / 1000),
          });
          toast.success('Video generated successfully!');
          return;
        }
        if (job.status === 'REVIEW_REQUIRED' || job.requiresReview) {
          toast.info('Render finished but was held for your review — open the AI Studio to accept or reject it.');
          return;
        }
        if (job.status === 'FAILED') {
          throw new Error(job.error || 'Video generation failed');
        }
      }
      throw new Error('Generation timed out');
    } catch (error) {
      console.error('Error processing voice-to-video:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process voice-to-video');
    } finally {
      setIsProcessing(false);
    }
  }, [audioBlob, options]);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setAudioUrl(null);
    setResult(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
  }, [audioUrl]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice-to-Video Generation
          </CardTitle>
          <CardDescription>
            Record your voice and let AI create a professional video for you
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Recording Controls */}
          <div className="flex items-center justify-center gap-4">
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              variant={isRecording ? "destructive" : "default"}
              size="lg"
              disabled={isProcessing}
              className={isRecording ? "" : "bg-blue-700 hover:bg-blue-800 text-white"}
            >
              {isRecording ? (
                <>
                  <MicOff className="h-4 w-4 mr-2" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4 mr-2" />
                  Start Recording
                </>
              )}
            </Button>

            {audioUrl && (
              <Button
                onClick={clearRecording}
                variant="outline"
                size="lg"
              >
                Clear
              </Button>
            )}
          </div>

          {/* Audio Preview */}
          {audioUrl && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Audio Preview</h4>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Language</label>
              <Select
                value={options.language}
                onValueChange={(value) => setOptions(prev => ({ ...prev, language: value }))}
              >
                <SelectTrigger aria-label="Select language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="hi">Hindi</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="it">Italian</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                  <SelectItem value="pt">Portuguese</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Video Style</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'modern', label: 'Modern', description: 'Clean, minimal' },
                  { value: 'cinematic', label: 'Cinematic', description: 'Film-like quality' },
                  { value: 'energetic', label: 'Energetic', description: 'Fast-paced, dynamic' },
                  { value: 'professional', label: 'Professional', description: 'Corporate, polished' }
                ].map((style) => (
                  <button
                    key={style.value}
                    onClick={() => setOptions(prev => ({ ...prev, videoStyle: style.value as any }))}
                    className={`p-3 text-left rounded-lg border transition-all ${
                      options.videoStyle === style.value
                        ? 'border-cyan-400 bg-cyan-400/10 text-white'
                        : 'border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-500 hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="font-medium text-sm">{style.label}</div>
                    <div className="text-xs text-gray-400 mt-1">{style.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="duration-slider">Duration: {options.duration}s</label>
              <div role="group" aria-labelledby="duration-label">
                <span id="duration-label" className="sr-only">Video duration in seconds</span>
                <Slider
                  id="duration-slider"
                  value={[options.duration]}
                  onValueChange={([value]) => setOptions(prev => ({ ...prev, duration: value }))}
                  min={10}
                  max={300}
                  step={5}
                  className="w-full"
                  aria-label="Video duration in seconds"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Quality</label>
              <Select
                value={options.quality}
                onValueChange={(value: any) => setOptions(prev => ({ ...prev, quality: value }))}
              >
                <SelectTrigger aria-label="Select video quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p HD</SelectItem>
                  <SelectItem value="1080p">1080p Full HD</SelectItem>
                  <SelectItem value="4k">4K Ultra HD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Process Button */}
          <Button
            onClick={processVoiceToVideo}
            disabled={!audioBlob || isProcessing}
            size="lg"
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Generate Video
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Generated Video</CardTitle>
            <CardDescription>
              Your voice has been converted to a professional video
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium">Duration:</span>
                <p>{result.duration}s</p>
              </div>
              <div>
                <span className="font-medium">Language:</span>
                <p>{result.language.toUpperCase()}</p>
              </div>
              <div>
                <span className="font-medium">Processing Time:</span>
                <p>{result.processingTime}s</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Transcript</h4>
              <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                {result.transcript}
              </p>
            </div>

            <div className="flex gap-2">
              <Button asChild>
                <a href={result.videoUrl} target="_blank" rel="noopener noreferrer">
                  <Play className="h-4 w-4 mr-2" />
                  Play Video
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={result.videoUrl} download>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default VoiceToVideoPanel;
