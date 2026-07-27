"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { X, ArrowRight, ArrowLeft, Target, Lightbulb } from "lucide-react"

interface TourStep {
  id: string
  title: string
  description: string
  target: string
  position: "top" | "bottom" | "left" | "right"
  action?: string
}

const tourSteps: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to ForgeVid!",
    description: "Let's take a quick tour of your new video creation workspace. This will only take 2 minutes.",
    target: "body",
    position: "top",
  },
  {
    id: "sidebar",
    title: "Navigation Sidebar",
    description: "Access all your tools here: My Videos, Templates, AI Studio, Media Library, and more.",
    target: "[data-tour='sidebar']",
    position: "right",
  },
  {
    id: "create-button",
    title: "Create New Video",
    description:
      "Click here to start creating your first AI-powered video. You can use templates or start from scratch.",
    target: "[data-tour='create-button']",
    position: "bottom",
    action: "Try creating your first video",
  },
  {
    id: "ai-studio",
    title: "AI Studio",
    description: "This is where the magic happens! Generate videos from text prompts using our advanced AI.",
    target: "[data-tour='ai-studio']",
    position: "left",
  },
  {
    id: "templates",
    title: "Template Gallery",
    description: "Browse professional templates to jumpstart your video creation.",
    target: "[data-tour='templates']",
    position: "left",
  },
  {
    id: "complete",
    title: "You're Ready!",
    description: "That's it! You now know the basics. Start creating amazing videos with AI assistance.",
    target: "body",
    position: "top",
  },
]

interface OnboardingTourProps {
  isOpen: boolean
  onClose: () => void
}

export function OnboardingTour({ isOpen, onClose }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setCurrentStep(0)
    }
  }, [isOpen])

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleClose()
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleClose = () => {
    setIsVisible(false)
    onClose()
  }

  const handleSkip = () => {
    handleClose()
  }

  if (!isVisible) return null

  const currentTourStep = tourSteps[currentStep]
  const progress = ((currentStep + 1) / tourSteps.length) * 100

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50" />

      {/* Tour Card */}
      <Card className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md mx-4">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                {currentStep === 0 || currentStep === tourSteps.length - 1 ? (
                  <Lightbulb className="h-4 w-4 text-primary" />
                ) : (
                  <Target className="h-4 w-4 text-primary" />
                )}
              </div>
              <Badge variant="secondary" className="text-xs">
                {currentStep + 1} of {tourSteps.length}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-lg text-slate-900 mb-2">{currentTourStep.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{currentTourStep.description}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-2">
              <div className="flex gap-2">
                {currentStep > 0 && (
                  <Button variant="outline" size="sm" onClick={handlePrevious}>
                    <ArrowLeft className="h-3 w-3 mr-1" />
                    Back
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleSkip} className="text-slate-600">
                  Skip Tour
                </Button>
              </div>

              <Button size="sm" onClick={handleNext}>
                {currentStep === tourSteps.length - 1 ? (
                  "Get Started"
                ) : (
                  <>
                    {currentTourStep.action || "Next"}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
