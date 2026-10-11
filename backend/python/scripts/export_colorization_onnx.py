"""
Exports the ECCV 2016 "Colorful Image Colorization" model (Zhang, Isola & Efros; BSD-2-Clause,
github.com/richzhang/colorization) from its official PyTorch weights to ONNX, so the image service runs it
with ONNX Runtime like its other models (OpenCV 5 no longer reads the original Caffe release).

    python scripts/export_colorization_onnx.py <weights.pth> <output.onnx>

Run once by scripts/setup-ml.sh, in the environment that has PyTorch (requirements-ai.txt). The network
is defined here exactly as in the upstream colorizers/eccv16.py; loading the weights strictly checks that.
"""

from __future__ import annotations

import sys

import torch
from torch import nn


def _block(channels_in: int, channels_out: int, count: int, *, last_stride: int = 1, dilation: int = 1) -> list[nn.Module]:
    layers: list[nn.Module] = []
    for index in range(count):
        stride = last_stride if index == count - 1 else 1
        layers += [nn.Conv2d(channels_in if index == 0 else channels_out, channels_out, 3, stride, dilation, dilation=dilation, bias=True), nn.ReLU(True)]
    return layers + [nn.BatchNorm2d(channels_out)]


class ECCVGenerator(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.model1 = nn.Sequential(*_block(1, 64, 2, last_stride=2))
        self.model2 = nn.Sequential(*_block(64, 128, 2, last_stride=2))
        self.model3 = nn.Sequential(*_block(128, 256, 3, last_stride=2))
        self.model4 = nn.Sequential(*_block(256, 512, 3))
        self.model5 = nn.Sequential(*_block(512, 512, 3, dilation=2))
        self.model6 = nn.Sequential(*_block(512, 512, 3, dilation=2))
        self.model7 = nn.Sequential(*_block(512, 512, 3))
        self.model8 = nn.Sequential(
            nn.ConvTranspose2d(512, 256, 4, 2, 1, bias=True),
            nn.ReLU(True),
            nn.Conv2d(256, 256, 3, 1, 1, bias=True),
            nn.ReLU(True),
            nn.Conv2d(256, 256, 3, 1, 1, bias=True),
            nn.ReLU(True),
            nn.Conv2d(256, 313, 1, 1, 0, bias=True),
        )
        self.softmax = nn.Softmax(dim=1)
        self.model_out = nn.Conv2d(313, 2, 1, 1, 0, bias=False)
        self.upsample4 = nn.Upsample(scale_factor=4, mode="bilinear")

    def forward(self, lightness: torch.Tensor) -> torch.Tensor:
        """L in 0–100 (1×1×H×W) → ab in Lab units (1×2×H×W)."""
        features = self.model1((lightness - 50.0) / 100.0)
        for stage in (self.model2, self.model3, self.model4, self.model5, self.model6, self.model7, self.model8):
            features = stage(features)
        return self.upsample4(self.model_out(self.softmax(features))) * 110.0


def main(weights: str, output: str) -> None:
    model = ECCVGenerator()
    model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True), strict=True)
    model.eval()
    sample = torch.full((1, 1, 256, 256), 50.0)
    torch.onnx.export(model, (sample,), output, input_names=["lightness"], output_names=["ab"], opset_version=17, dynamo=False)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: export_colorization_onnx.py <weights.pth> <output.onnx>")
    main(sys.argv[1], sys.argv[2])
