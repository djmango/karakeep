import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Github, Star } from "lucide-react";

import { DEMO_LINK, GITHUB_LINK } from "../constants";
import heroImage from "/hero.webp?url";

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:pt-24">
      <div className="animate-fade-in-up mx-auto max-w-5xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
          The{" "}
          <span className="bg-gradient-to-r from-purple-600 to-red-600 bg-clip-text text-transparent">
            Bookmark Everything
          </span>{" "}
          App
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
          Quickly save links, notes, and images and Karakeep will automatically
          tag them for you using AI for faster retrieval. Built for the data
          hoarders out there!
        </p>
        <div className="mt-6 flex items-center justify-center">
          <a
            href={GITHUB_LINK}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
          >
            <Star className="size-4 fill-yellow-400 text-yellow-400" />
            <span className="font-semibold">24k+</span>
            <span className="text-gray-500">stars on GitHub</span>
          </a>
        </div>
        <div className="mt-8 flex items-center justify-center gap-4">
          <a
            href={DEMO_LINK}
            target="_blank"
            className={cn(
              "gap-2 px-8",
              buttonVariants({ variant: "default", size: "lg" }),
            )}
            rel="noreferrer"
          >
            Try Demo
          </a>
          <a
            href={GITHUB_LINK}
            target="_blank"
            className={cn(
              "gap-2 px-8",
              buttonVariants({ variant: "outline", size: "lg" }),
            )}
            rel="noreferrer"
          >
            <Github className="size-5" /> GitHub
          </a>
        </div>
      </div>

      {/* Hero screenshot with browser mockup */}
      <div className="animate-fade-in relative mx-auto mt-16 max-w-screen-2xl px-4">
        {/* Glow effect */}
        <div className="animate-glow-pulse absolute -inset-4 rounded-3xl bg-gradient-to-r from-purple-400/20 via-pink-400/20 to-red-400/20 blur-3xl" />

        <img
          src={heroImage}
          alt="Karakeep dashboard"
          className="relative w-full"
        />
      </div>
    </section>
  );
}
