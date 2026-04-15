import AppKit
import Foundation
import Vision

struct OcrEntry: Codable {
  let path: String
  let text: String
}

func recognizeText(at path: String) throws -> String {
  guard let image = NSImage(contentsOfFile: path) else {
    throw NSError(
      domain: "IdenaAppleOcr",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Unable to load image at \(path)"]
    )
  }

  var rect = NSRect(origin: .zero, size: image.size)
  guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    throw NSError(
      domain: "IdenaAppleOcr",
      code: 2,
      userInfo: [NSLocalizedDescriptionKey: "Unable to create CGImage for \(path)"]
    )
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  try handler.perform([request])

  let text = (request.results ?? [])
    .compactMap { observation in
      observation.topCandidates(1).first?.string
    }
    .joined(separator: "\n")

  return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

let imagePaths = Array(CommandLine.arguments.dropFirst())

guard !imagePaths.isEmpty else {
  fputs("Usage: apple-ocr.swift <image-path> [...]\n", stderr)
  exit(64)
}

let results = try imagePaths.map { path in
  OcrEntry(path: path, text: try recognizeText(at: path))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted]
let output = try encoder.encode(results)
FileHandle.standardOutput.write(output)
