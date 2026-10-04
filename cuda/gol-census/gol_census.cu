// Brute-force Game of Life census for the laptop 3060.
//
// Same rule as src/workers/gol-census-core.ts: a W×H box with a dead exterior
// (no wrap), B3/S23, Brent cycle detection. Period 1 landing on the empty
// board counts as "dies"; any other period-1 cycle is a still life.
//
// The state index is a uint64, row 0 in the low bits, so W*H must be ≤ 64.
// 8×8 is the largest square. A full 8×8 is 2^64 states and has to be run as
// slices: START and COUNT select [START, START+COUNT).
//
// Build on the laptop (the workshop box has no NVIDIA GPU):
//   make
//   ./gol-census --verify
//   ./gol-census 8 8 0 2^24

#include <cuda_runtime.h>

#include <chrono>
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

static constexpr int MAX_W = 32;
static constexpr int MAX_H = 16;
static constexpr int BRENT_CAP = 1 << 20;
static constexpr int MAX_PERIOD = 512;

static constexpr int BIN_UNRESOLVED = 0;
static constexpr int BIN_DIES = 1;
static constexpr int BIN_STILL = 2;
static constexpr int BIN_OVERFLOW = 3;
static constexpr int BIN_PERIOD = 4; // period p>=2 → BIN_PERIOD + (p-2)
static constexpr int HIST_BINS = 4 + (MAX_PERIOD - 2);

static constexpr uint64_t CHUNK = 1ull << 24;

#define CHECK(cmd)                                                                 \
  do {                                                                             \
    cudaError_t err_ = (cmd);                                                      \
    if (err_ != cudaSuccess) {                                                     \
      fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, cudaGetErrorString(err_)); \
      exit(1);                                                                     \
    }                                                                              \
  } while (0)

__host__ __device__ inline uint32_t row_mask(int w) {
  return w >= 32 ? 0xffffffffu : ((1u << w) - 1u);
}

template <int W, int H>
__host__ __device__ void step(const uint32_t src[H], uint32_t dst[H]) {
  constexpr uint32_t mask = (W >= 32) ? 0xffffffffu : ((1u << W) - 1u);
  uint32_t h0[H], h1[H], u0[H], u1[H];
#pragma unroll
  for (int y = 0; y < H; ++y) {
    uint32_t v = src[y];
    uint32_t L = (v << 1) & mask;
    uint32_t R = v >> 1;
    uint32_t x = L ^ v;
    h0[y] = x ^ R;
    h1[y] = (L & v) | (x & R);
    u0[y] = L ^ R;
    u1[y] = L & R;
  }
#pragma unroll
  for (int y = 0; y < H; ++y) {
    uint32_t a0 = y > 0 ? h0[y - 1] : 0;
    uint32_t a1 = y > 0 ? h1[y - 1] : 0;
    uint32_t c0 = y + 1 < H ? h0[y + 1] : 0;
    uint32_t c1 = y + 1 < H ? h1[y + 1] : 0;
    uint32_t b0 = u0[y];
    uint32_t b1 = u1[y];
    uint32_t t = a0 ^ b0;
    uint32_t ones = t ^ c0;
    uint32_t car = (a0 & b0) | (t & c0);
    uint32_t t2 = a1 ^ b1;
    uint32_t s2 = t2 ^ c1;
    uint32_t c2a = (a1 & b1) | (t2 & c1);
    uint32_t twos = s2 ^ car;
    uint32_t c2b = s2 & car;
    uint32_t fours = c2a | c2b;
    dst[y] = (twos & ~fours & (ones | src[y])) & mask;
  }
}

template <int H>
__host__ __device__ bool same(const uint32_t *a, const uint32_t *b) {
#pragma unroll
  for (int y = 0; y < H; ++y)
    if (a[y] != b[y]) return false;
  return true;
}

template <int H>
__host__ __device__ bool all_zero(const uint32_t *a) {
#pragma unroll
  for (int y = 0; y < H; ++y)
    if (a[y]) return false;
  return true;
}

// Histogram bin of the attractor. Most boards die or settle into period 1 or 2,
// so those are detected in a tight loop; longer cycles fall through to Brent.
// `guard` is the step budget (BRENT_CAP). 0 means unresolved.
template <int W, int H>
__host__ __device__ int fate_from(uint32_t *origin, int guard) {
  // Fixed-length probe. Boards are named arrays, not swapped pointers, so the
  // step stays in registers the way the inner-loop microbenchmark does.
  constexpr int FAST = 16;
  uint32_t older[H], cur[H], nxt[H];
  if (guard <= 0) return BIN_UNRESOLVED;
#pragma unroll
  for (int y = 0; y < H; ++y) older[y] = origin[y];
  step<W, H>(older, cur);
  --guard;
  int found = same<H>(older, cur);
  int early = found ? (all_zero<H>(cur) ? BIN_DIES : BIN_STILL) : 0;

#pragma unroll 1
  for (int i = 0; i < FAST && guard > 0; ++i) {
    step<W, H>(cur, nxt);
    --guard;
    if (!found) {
      if (same<H>(nxt, cur)) {
        found = 1;
        early = all_zero<H>(nxt) ? BIN_DIES : BIN_STILL;
      } else if (same<H>(nxt, older)) {
        found = 1;
        early = BIN_PERIOD;
      }
    }
#pragma unroll
    for (int y = 0; y < H; ++y) older[y] = cur[y];
#pragma unroll
    for (int y = 0; y < H; ++y) cur[y] = nxt[y];
  }
  if (found) return early;

  uint32_t tort[H], buf_a[H], buf_b[H];
#pragma unroll
  for (int y = 0; y < H; ++y) tort[y] = cur[y];
  if (guard <= 0) return BIN_UNRESOLVED;
  step<W, H>(tort, buf_a);
  --guard;
  uint32_t *hare = buf_a;
  uint32_t *spare = buf_b;
  int power = 1;
  int lam = 1;
  while (!same<H>(tort, hare)) {
    if (guard <= 0) return BIN_UNRESOLVED;
    if (power == lam) {
#pragma unroll
      for (int y = 0; y < H; ++y) tort[y] = hare[y];
      power <<= 1;
      lam = 0;
    }
    step<W, H>(hare, spare);
    uint32_t *tmp = hare;
    hare = spare;
    spare = tmp;
    ++lam;
    --guard;
  }
  if (lam == 1) return all_zero<H>(hare) ? BIN_DIES : BIN_STILL;
  if (lam >= MAX_PERIOD) return BIN_OVERFLOW;
  return BIN_PERIOD + (lam - 2);
}

template <int W, int H>
__host__ __device__ int fate_bin(uint64_t state) {
  constexpr uint32_t mask = (W >= 32) ? 0xffffffffu : ((1u << W) - 1u);
  uint32_t rows[H];
#pragma unroll
  for (int y = 0; y < H; ++y)
    rows[y] = (uint32_t)((state >> (y * W)) & mask);
  return fate_from<W, H>(rows, BRENT_CAP);
}

template <int W>
__host__ __device__ uint32_t rev_row(uint32_t v) {
#if defined(__CUDA_ARCH__)
  return __brev(v) >> (32 - W);
#else
  uint32_t r = 0;
  for (int b = 0; b < W; ++b)
    if (v & (1u << b)) r |= 1u << (W - 1 - b);
  return r;
#endif
}

// Column x of the board, packed so bit y is rows[y] bit x. One column is enough
// to compare the leading row of a transpose image; the rest is built only when
// that row ties.
template <int H>
__host__ __device__ uint32_t column_bits(const uint32_t *rows, int x) {
  uint32_t r = 0;
#pragma unroll
  for (int y = 0; y < H; ++y)
    r |= ((rows[y] >> x) & 1u) << y;
  return r;
}

// Lexicographic orbit minimum under the board's symmetry group.
// Squares: D4, weight 8/|stabilizer|. Rectangles: Klein group, weight 4/|stab|.
// 0 means some image has a smaller index, so this state is not simulated.
// Matches canonicalWeight in src/workers/gol-census-core.ts. Single-row boards
// are not reduced (the TS engine brute-forces those).
template <int W, int H>
__host__ __device__ int orbit_weight(uint64_t state) {
  if (H < 2) return 1;
  constexpr uint32_t mask = (W >= 32) ? 0xffffffffu : ((1u << W) - 1u);
  uint32_t rows[H];
#pragma unroll
  for (int y = 0; y < H; ++y)
    rows[y] = (uint32_t)((state >> (y * W)) & mask);

  const uint32_t top = rows[H - 1];
  const uint32_t rt = rev_row<W>(top);
  if (rt < top) return 0;
  const bool h_deep = rt == top;
  if (rows[0] < top) return 0;

  int stab = 1;
  if (rows[0] == top) {
    int c = 0;
    for (int y = H - 2; y >= 0; --y) {
      uint32_t t = rows[H - 1 - y], o = rows[y];
      if (t != o) {
        c = t < o ? -1 : 1;
        break;
      }
    }
    if (c < 0) return 0;
    if (c == 0) ++stab;
  }
  if (h_deep) {
    int c = 0;
    for (int y = H - 2; y >= 0; --y) {
      uint32_t t = rev_row<W>(rows[y]), o = rows[y];
      if (t != o) {
        c = t < o ? -1 : 1;
        break;
      }
    }
    if (c < 0) return 0;
    if (c == 0) ++stab;
  }
  {
    uint32_t lead = rev_row<W>(rows[0]);
    if (lead < top) return 0;
    if (lead == top) {
      int c = 0;
      for (int y = H - 2; y >= 0; --y) {
        uint32_t t = rev_row<W>(rows[H - 1 - y]), o = rows[y];
        if (t != o) {
          c = t < o ? -1 : 1;
          break;
        }
      }
      if (c < 0) return 0;
      if (c == 0) ++stab;
    }
  }
  if (W != H) return 4 / stab;

  // T, VT, HT, HVT. Leading row of each is column H-1 or column 0, plain or
  // bit-reversed. A mismatch there settles the image; a tie walks downward.
  const uint32_t col_hi = column_bits<H>(rows, H - 1);
  const uint32_t col_lo = column_bits<H>(rows, 0);
  const uint32_t leads[4] = {col_hi, col_lo, rev_row<W>(col_hi), rev_row<W>(col_lo)};
  const int flip_v[4] = {0, 1, 0, 1};
  const int flip_h[4] = {0, 0, 1, 1};
#pragma unroll
  for (int image = 0; image < 4; ++image) {
    const uint32_t lead = leads[image];
    if (lead < top) return 0;
    if (lead > top) continue;
    int c = 0;
    for (int y = H - 2; y >= 0; --y) {
      const int x = flip_v[image] ? (H - 1 - y) : y;
      uint32_t t = column_bits<H>(rows, x);
      if (flip_h[image]) t = rev_row<W>(t);
      const uint32_t o = rows[y];
      if (t != o) {
        c = t < o ? -1 : 1;
        break;
      }
    }
    if (c < 0) return 0;
    if (c == 0) ++stab;
  }
  return 8 / stab;
}

// Not inlined into the census kernel, so the orbit test and the Life step
// don't share one register budget and spill the board into local memory.
template <int W, int H>
__device__ __noinline__ int orbit_weight_ni(uint64_t state) {
  return orbit_weight<W, H>(state);
}

template <int W, int H>
__device__ __noinline__ int fate_bin_ni(uint64_t state) {
  return fate_bin<W, H>(state);
}

__host__ __device__ void step_rt(int w, int h, const uint32_t *src, uint32_t *dst) {
  uint32_t mask = row_mask(w);
  uint32_t h0[MAX_H], h1[MAX_H], u0[MAX_H], u1[MAX_H];
  for (int y = 0; y < h; ++y) {
    uint32_t v = src[y];
    uint32_t L = (v << 1) & mask;
    uint32_t R = v >> 1;
    uint32_t x = L ^ v;
    h0[y] = x ^ R;
    h1[y] = (L & v) | (x & R);
    u0[y] = L ^ R;
    u1[y] = L & R;
  }
  for (int y = 0; y < h; ++y) {
    uint32_t a0 = y > 0 ? h0[y - 1] : 0;
    uint32_t a1 = y > 0 ? h1[y - 1] : 0;
    uint32_t c0 = y + 1 < h ? h0[y + 1] : 0;
    uint32_t c1 = y + 1 < h ? h1[y + 1] : 0;
    uint32_t b0 = u0[y];
    uint32_t b1 = u1[y];
    uint32_t t = a0 ^ b0;
    uint32_t ones = t ^ c0;
    uint32_t car = (a0 & b0) | (t & c0);
    uint32_t t2 = a1 ^ b1;
    uint32_t s2 = t2 ^ c1;
    uint32_t c2a = (a1 & b1) | (t2 & c1);
    uint32_t twos = s2 ^ car;
    uint32_t c2b = s2 & car;
    uint32_t fours = c2a | c2b;
    dst[y] = (twos & ~fours & (ones | src[y])) & mask;
  }
}

__host__ __device__ int fate_bin_rt(int w, int h, uint64_t state) {
  uint32_t mask = row_mask(w);
  uint32_t rows[MAX_H];
  for (int y = 0; y < h; ++y)
    rows[y] = (uint32_t)((state >> (y * w)) & mask);

  uint32_t tort[MAX_H], buf_a[MAX_H], buf_b[MAX_H];
  for (int y = 0; y < h; ++y) tort[y] = rows[y];
  step_rt(w, h, tort, buf_a);

  uint32_t *hare = buf_a;
  uint32_t *spare = buf_b;
  int power = 1;
  int lam = 1;
  int guard = BRENT_CAP;
  while (true) {
    bool eq = true;
    for (int y = 0; y < h; ++y)
      if (tort[y] != hare[y]) {
        eq = false;
        break;
      }
    if (eq) break;
    if (power == lam) {
      for (int y = 0; y < h; ++y) tort[y] = hare[y];
      power <<= 1;
      lam = 0;
    }
    step_rt(w, h, hare, spare);
    uint32_t *tmp = hare;
    hare = spare;
    spare = tmp;
    ++lam;
    if (--guard == 0) return BIN_UNRESOLVED;
  }
  if (lam == 1) {
    for (int y = 0; y < h; ++y)
      if (hare[y]) return BIN_STILL;
    return BIN_DIES;
  }
  if (lam >= MAX_PERIOD) return BIN_OVERFLOW;
  return BIN_PERIOD + (lam - 2);
}

template <int W, int H>
__global__ void census_kernel(uint64_t start, uint64_t count, unsigned long long *global) {
  __shared__ unsigned long long hist[HIST_BINS];
  for (int i = threadIdx.x; i < HIST_BINS; i += blockDim.x) hist[i] = 0;
  __syncthreads();

  unsigned long long dies = 0;
  unsigned long long stills = 0;
  const uint64_t stride = (uint64_t)gridDim.x * blockDim.x;
  const uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  for (uint64_t i = tid; i < count; i += stride) {
    int bin = fate_bin<W, H>(start + i);
    if (bin == BIN_DIES) ++dies;
    else if (bin == BIN_STILL) ++stills;
    else atomicAdd(&hist[bin], 1ull);
  }
  if (dies) atomicAdd(&hist[BIN_DIES], dies);
  if (stills) atomicAdd(&hist[BIN_STILL], stills);
  __syncthreads();

  for (int i = threadIdx.x; i < HIST_BINS; i += blockDim.x) {
    unsigned long long n = hist[i];
    if (n) atomicAdd(&global[i], n);
  }
}

__global__ void census_kernel_rt(int w, int h, uint64_t start, uint64_t count, unsigned long long *global) {
  __shared__ unsigned long long hist[HIST_BINS];
  for (int i = threadIdx.x; i < HIST_BINS; i += blockDim.x) hist[i] = 0;
  __syncthreads();

  unsigned long long dies = 0;
  unsigned long long stills = 0;
  const uint64_t stride = (uint64_t)gridDim.x * blockDim.x;
  const uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  for (uint64_t i = tid; i < count; i += stride) {
    int bin = fate_bin_rt(w, h, start + i);
    if (bin == BIN_DIES) ++dies;
    else if (bin == BIN_STILL) ++stills;
    else atomicAdd(&hist[bin], 1ull);
  }
  if (dies) atomicAdd(&hist[BIN_DIES], dies);
  if (stills) atomicAdd(&hist[BIN_STILL], stills);
  __syncthreads();

  for (int i = threadIdx.x; i < HIST_BINS; i += blockDim.x) {
    unsigned long long n = hist[i];
    if (n) atomicAdd(&global[i], n);
  }
}

// Each warp keeps its own queue of 32 orbit minima and classifies them only
// when every lane has one. That stays full-warp even on the low top-rows,
// where about half the states are minima and the old fixed cap overflowed
// into a divergent second pass. No block-wide sync on the hot path.
template <int W, int H>
__global__ void sym_kernel(uint64_t start, uint64_t count, unsigned long long *global) {
  constexpr int BLOCK = 256;
  constexpr int NW = BLOCK / 32;

  __shared__ unsigned long long hist[HIST_BINS];
  __shared__ uint64_t qstate[NW][32];
  __shared__ unsigned char qweight[NW][32];

  for (int i = threadIdx.x; i < HIST_BINS; i += BLOCK) hist[i] = 0;
  __syncthreads();

  const int warp = threadIdx.x >> 5;
  const int lane = threadIdx.x & 31;
  unsigned long long dies = 0;
  unsigned long long stills = 0;

  const uint64_t nwarps = (uint64_t)gridDim.x * NW;
  const uint64_t warp_id = (uint64_t)blockIdx.x * NW + warp;
  const uint64_t nvectors = (count + 31ull) / 32ull;
  const uint64_t trips = (nvectors + nwarps - 1) / nwarps;
  int queued = 0;

  for (uint64_t t = 0; t < trips; ++t) {
    const uint64_t vec = warp_id + t * nwarps;
    const uint64_t rel = vec * 32ull + (uint64_t)lane;
    int weight = 0;
    if (vec < nvectors && rel < count) weight = orbit_weight_ni<W, H>(start + rel);

    const unsigned mask = __ballot_sync(0xffffffff, weight != 0);
    const int nkeep = __popc(mask);
    const int rank = __popc(mask & ((1u << lane) - 1));
    const bool keep = weight != 0;
    const int space = 32 - queued;
    const int take = nkeep < space ? nkeep : space;

    if (keep && rank < take) {
      qstate[warp][queued + rank] = start + rel;
      qweight[warp][queued + rank] = (unsigned char)weight;
    }
    __syncwarp();
    queued += take;

    if (queued == 32) {
      const uint64_t mine = qstate[warp][lane];
      const unsigned char w = qweight[warp][lane];
      __syncwarp();
      const int left = nkeep - take;
      if (keep && rank >= take) {
        qstate[warp][rank - take] = start + rel;
        qweight[warp][rank - take] = (unsigned char)weight;
      }
      const int bin = fate_bin_ni<W, H>(mine);
      if (bin == BIN_DIES) dies += w;
      else if (bin == BIN_STILL) stills += w;
      else atomicAdd(&hist[bin], (unsigned long long)w);
      queued = left;
    }
  }

  __syncwarp();
  if (lane < queued) {
    const int bin = fate_bin_ni<W, H>(qstate[warp][lane]);
    const unsigned char w = qweight[warp][lane];
    if (bin == BIN_DIES) dies += w;
    else if (bin == BIN_STILL) stills += w;
    else atomicAdd(&hist[bin], (unsigned long long)w);
  }

  if (dies) atomicAdd(&hist[BIN_DIES], dies);
  if (stills) atomicAdd(&hist[BIN_STILL], stills);
  __syncthreads();
  for (int i = threadIdx.x; i < HIST_BINS; i += BLOCK) {
    unsigned long long n = hist[i];
    if (n) atomicAdd(&global[i], n);
  }
}

// --json streams one CensusResult-shaped object per line and checkpoints the
// device histogram so a killed run resumes. The index `origin` is where this
// invocation's `done` counter starts (0, or a checkpoint).
struct ProgressCtl {
  bool json = false;
  int w = 0;
  int h = 0;
  uint64_t origin = 0;
  uint64_t total = 0;
  double elapsed_base = 0;
  std::chrono::steady_clock::time_point t0{};
  std::chrono::steady_clock::time_point last{};
  bool have_last = false;
  const char *ckpt = nullptr;
};

static void print_census_json(const char *type, int w, int h, uint64_t processed, uint64_t total,
                              const uint64_t *hist, double elapsed_sec, double rate, bool done) {
  uint64_t unresolved = hist[BIN_UNRESOLVED] + hist[BIN_OVERFLOW];
  printf("{\"type\":\"%s\",\"w\":%d,\"h\":%d,\"total\":%" PRIu64 ",\"processed\":%" PRIu64
         ",\"dies\":%" PRIu64 ",\"stillLifes\":%" PRIu64 ",\"unresolved\":%" PRIu64 ",\"periods\":{",
         type, w, h, total, processed, hist[BIN_DIES], hist[BIN_STILL], unresolved);
  bool first = true;
  for (int p = 2; p < MAX_PERIOD; ++p) {
    uint64_t n = hist[BIN_PERIOD + (p - 2)];
    if (!n) continue;
    if (!first) fputc(',', stdout);
    first = false;
    printf("\"%d\":%" PRIu64, p, n);
  }
  printf("},\"oscExamples\":[],\"stillLifeExamples\":[],\"done\":%s,\"elapsedMs\":%.0f,\"engine\":\"gpu\",\"rate\":%.0f}\n",
         done ? "true" : "false", elapsed_sec * 1000.0, rate);
  fflush(stdout);
}

static constexpr char CKPT_MAGIC[4] = {'G', 'C', '0', '1'};

static void write_ckpt(const char *path, int w, int h, uint64_t processed, double elapsed, const uint64_t *hist) {
  char tmp[512];
  if (std::snprintf(tmp, sizeof(tmp), "%s.tmp", path) >= (int)sizeof(tmp)) return;
  FILE *f = std::fopen(tmp, "wb");
  if (!f) return;
  int32_t ww = w, hh = h;
  bool ok = std::fwrite(CKPT_MAGIC, 1, 4, f) == 4
            && std::fwrite(&ww, sizeof(ww), 1, f) == 1
            && std::fwrite(&hh, sizeof(hh), 1, f) == 1
            && std::fwrite(&processed, sizeof(processed), 1, f) == 1
            && std::fwrite(&elapsed, sizeof(elapsed), 1, f) == 1
            && std::fwrite(hist, sizeof(uint64_t), HIST_BINS, f) == (size_t)HIST_BINS;
  std::fclose(f);
  if (ok) std::rename(tmp, path);
  else std::remove(tmp);
}

// Returns false when the file is missing, short, or for a different board.
static bool read_ckpt(const char *path, int w, int h, uint64_t *processed, double *elapsed, uint64_t *hist) {
  FILE *f = std::fopen(path, "rb");
  if (!f) return false;
  char magic[4];
  int32_t ww = 0, hh = 0;
  bool ok = std::fread(magic, 1, 4, f) == 4
            && std::memcmp(magic, CKPT_MAGIC, 4) == 0
            && std::fread(&ww, sizeof(ww), 1, f) == 1
            && std::fread(&hh, sizeof(hh), 1, f) == 1
            && ww == w && hh == h
            && std::fread(processed, sizeof(*processed), 1, f) == 1
            && std::fread(elapsed, sizeof(*elapsed), 1, f) == 1
            && std::fread(hist, sizeof(uint64_t), HIST_BINS, f) == (size_t)HIST_BINS;
  std::fclose(f);
  return ok;
}

static void note_progress(ProgressCtl *prog, uint64_t done, unsigned long long *d) {
  auto now = std::chrono::steady_clock::now();
  if (prog->have_last && now - prog->last < std::chrono::milliseconds(400)) return;
  prog->last = now;
  prog->have_last = true;
  uint64_t hist[HIST_BINS];
  CHECK(cudaMemcpy(hist, d, sizeof(hist), cudaMemcpyDeviceToHost));
  double session = std::chrono::duration<double>(now - prog->t0).count();
  double elapsed = prog->elapsed_base + session;
  double rate = session > 0 ? (double)done / session : 0;
  uint64_t processed = prog->origin + done;
  print_census_json("progress", prog->w, prog->h, processed, prog->total, hist, elapsed, rate, false);
  if (prog->ckpt) write_ckpt(prog->ckpt, prog->w, prog->h, processed, elapsed, hist);
}

static int pick_blocks(uint64_t count) {
  int sms = 1;
  CHECK(cudaDeviceGetAttribute(&sms, cudaDevAttrMultiProcessorCount, 0));
  int blocks = sms * 8;
  uint64_t need = (count + 255ull) / 256ull;
  if ((uint64_t)blocks > need) blocks = (int)need;
  if (blocks < 1) blocks = 1;
  return blocks;
}

template <int W, int H>
void gpu_census(uint64_t start, uint64_t count, uint64_t *host, const uint64_t *seed = nullptr, ProgressCtl *prog = nullptr) {
  unsigned long long *d = nullptr;
  CHECK(cudaMalloc(&d, HIST_BINS * sizeof(unsigned long long)));
  if (seed) CHECK(cudaMemcpy(d, seed, HIST_BINS * sizeof(uint64_t), cudaMemcpyHostToDevice));
  else CHECK(cudaMemset(d, 0, HIST_BINS * sizeof(unsigned long long)));

  auto t0 = std::chrono::steady_clock::now();
  for (uint64_t done = 0; done < count;) {
    uint64_t n = count - done;
    if (n > CHUNK) n = CHUNK;
    int blocks = pick_blocks(n);
    census_kernel<W, H><<<blocks, 256>>>(start + done, n, d);
    CHECK(cudaGetLastError());
    CHECK(cudaDeviceSynchronize());
    done += n;
    if (prog && prog->json) note_progress(prog, done, d);
    else if (count > CHUNK) {
      double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      double rate = sec > 0 ? (double)done / sec : 0;
      fprintf(stderr, "\r  %d×%d  %" PRIu64 " / %" PRIu64 "   %.2f M states/s", W, H, done, count, rate / 1e6);
      fflush(stderr);
    }
  }
  if (!(prog && prog->json) && count > CHUNK) fputc('\n', stderr);
  CHECK(cudaMemcpy(host, d, HIST_BINS * sizeof(uint64_t), cudaMemcpyDeviceToHost));
  CHECK(cudaFree(d));
}

template <int W, int H>
void gpu_census_sym(uint64_t start, uint64_t count, uint64_t *host, const uint64_t *seed = nullptr, ProgressCtl *prog = nullptr) {
  unsigned long long *d = nullptr;
  CHECK(cudaMalloc(&d, HIST_BINS * sizeof(unsigned long long)));
  if (seed) CHECK(cudaMemcpy(d, seed, HIST_BINS * sizeof(uint64_t), cudaMemcpyHostToDevice));
  else CHECK(cudaMemset(d, 0, HIST_BINS * sizeof(unsigned long long)));

  auto t0 = std::chrono::steady_clock::now();
  for (uint64_t done = 0; done < count;) {
    uint64_t n = count - done;
    if (n > CHUNK) n = CHUNK;
    int blocks = pick_blocks(n);
    sym_kernel<W, H><<<blocks, 256>>>(start + done, n, d);
    CHECK(cudaGetLastError());
    CHECK(cudaDeviceSynchronize());
    done += n;
    if (prog && prog->json) note_progress(prog, done, d);
    else if (count > CHUNK) {
      double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      double rate = sec > 0 ? (double)done / sec : 0;
      fprintf(stderr, "\r  %d×%d  %" PRIu64 " / %" PRIu64 "   %.2f M states/s", W, H, done, count, rate / 1e6);
      fflush(stderr);
    }
  }
  if (!(prog && prog->json) && count > CHUNK) fputc('\n', stderr);
  CHECK(cudaMemcpy(host, d, HIST_BINS * sizeof(uint64_t), cudaMemcpyDeviceToHost));
  CHECK(cudaFree(d));
}

static void gpu_census_rt(int w, int h, uint64_t start, uint64_t count, uint64_t *host, const uint64_t *seed = nullptr, ProgressCtl *prog = nullptr) {
  unsigned long long *d = nullptr;
  CHECK(cudaMalloc(&d, HIST_BINS * sizeof(unsigned long long)));
  if (seed) CHECK(cudaMemcpy(d, seed, HIST_BINS * sizeof(uint64_t), cudaMemcpyHostToDevice));
  else CHECK(cudaMemset(d, 0, HIST_BINS * sizeof(unsigned long long)));

  auto t0 = std::chrono::steady_clock::now();
  for (uint64_t done = 0; done < count;) {
    uint64_t n = count - done;
    if (n > CHUNK) n = CHUNK;
    int blocks = pick_blocks(n);
    census_kernel_rt<<<blocks, 256>>>(w, h, start + done, n, d);
    CHECK(cudaGetLastError());
    CHECK(cudaDeviceSynchronize());
    done += n;
    if (prog && prog->json) note_progress(prog, done, d);
    else if (count > CHUNK) {
      double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      double rate = sec > 0 ? (double)done / sec : 0;
      fprintf(stderr, "\r  %d×%d  %" PRIu64 " / %" PRIu64 "   %.2f M states/s", w, h, done, count, rate / 1e6);
      fflush(stderr);
    }
  }
  if (!(prog && prog->json) && count > CHUNK) fputc('\n', stderr);
  CHECK(cudaMemcpy(host, d, HIST_BINS * sizeof(uint64_t), cudaMemcpyDeviceToHost));
  CHECK(cudaFree(d));
}

static void clear_hist(uint64_t *hist) {
  for (int i = 0; i < HIST_BINS; ++i) hist[i] = 0;
}

static void run_census(int w, int h, uint64_t start, uint64_t count, uint64_t *hist, bool sym, const uint64_t *seed = nullptr, ProgressCtl *prog = nullptr) {
  if (!seed) clear_hist(hist);
  if (sym && h > 1 && w <= 8 && h <= 8) {
#define SPECIAL_SYM(W, H)                                      \
  if (w == W && h == H) {                                      \
    gpu_census_sym<W, H>(start, count, hist, seed, prog);      \
    return;                                                    \
  }
#define ROW_SYM(W) SPECIAL_SYM(W, 2) SPECIAL_SYM(W, 3) SPECIAL_SYM(W, 4) SPECIAL_SYM(W, 5) SPECIAL_SYM(W, 6) SPECIAL_SYM(W, 7) SPECIAL_SYM(W, 8)
    ROW_SYM(1) ROW_SYM(2) ROW_SYM(3) ROW_SYM(4) ROW_SYM(5) ROW_SYM(6) ROW_SYM(7) ROW_SYM(8)
#undef ROW_SYM
#undef SPECIAL_SYM
  }
#define SPECIAL(W, H)                                     \
  if (w == W && h == H) {                                 \
    gpu_census<W, H>(start, count, hist, seed, prog);     \
    return;                                               \
  }
#define ROW(W) SPECIAL(W, 1) SPECIAL(W, 2) SPECIAL(W, 3) SPECIAL(W, 4) SPECIAL(W, 5) SPECIAL(W, 6) SPECIAL(W, 7) SPECIAL(W, 8)
  ROW(1) ROW(2) ROW(3) ROW(4) ROW(5) ROW(6) ROW(7) ROW(8)
#undef ROW
#undef SPECIAL
  gpu_census_rt(w, h, start, count, hist, seed, prog);
}

static uint64_t hist_total(const uint64_t *hist) {
  uint64_t n = 0;
  for (int i = 0; i < HIST_BINS; ++i) n += hist[i];
  return n;
}

static uint64_t osc_total(const uint64_t *hist) {
  uint64_t n = hist[BIN_OVERFLOW];
  for (int p = 2; p < MAX_PERIOD; ++p) n += hist[BIN_PERIOD + (p - 2)];
  return n;
}

static void print_hist(int w, int h, uint64_t start, uint64_t count, const uint64_t *hist, double seconds, const char *mode) {
  double rate = seconds > 0 ? (double)count / seconds : 0;
  printf("%d×%d  %s  [%" PRIu64 ", %" PRIu64 ")  %.3fs  %.2f M states/s\n", w, h, mode, start, start + count, seconds, rate / 1e6);
  printf("  dies          %" PRIu64 "\n", hist[BIN_DIES]);
  printf("  still lifes   %" PRIu64 "\n", hist[BIN_STILL]);
  printf("  unresolved    %" PRIu64 "\n", hist[BIN_UNRESOLVED]);
  for (int p = 2; p < MAX_PERIOD; ++p) {
    uint64_t n = hist[BIN_PERIOD + (p - 2)];
    if (n) printf("  period %-6d %" PRIu64 "\n", p, n);
  }
  if (hist[BIN_OVERFLOW]) printf("  period >=%-4d %" PRIu64 "\n", MAX_PERIOD, hist[BIN_OVERFLOW]);
  printf("  total         %" PRIu64 "\n", hist_total(hist));
}

static bool hist_equal(const uint64_t *a, const uint64_t *b) {
  for (int i = 0; i < HIST_BINS; ++i)
    if (a[i] != b[i]) return false;
  return true;
}

static int g_failures = 0;

static void expect_eq(const char *label, uint64_t got, uint64_t want) {
  if (got == want) {
    printf("  ok  %s = %" PRIu64 "\n", label, got);
  } else {
    ++g_failures;
    printf("  FAIL %s = %" PRIu64 "  want %" PRIu64 "\n", label, got, want);
  }
}

static void usage() {
  fprintf(stderr,
          "usage: gol-census [mode] W H [START COUNT]\n"
          "       gol-census --verify\n"
          "\n"
          "A full board (no START/COUNT, W*H < 64) uses dihedral symmetry,\n"
          "the same reduction as the TypeScript census. A slice is brute\n"
          "force, so its histogram is exact for that index range.\n"
          "--brute       force the full simulation\n"
          "--sym         symmetry even on a slice (counts are then NOT a census\n"
          "              of the slice; useful for timing)\n"
          "--cpu         one laptop/host thread, no GPU\n"
          "--json        NDJSON progress + result on stdout (workshop UI)\n"
          "--checkpoint  path for a resumable histogram (with --json)\n"
          "--fresh       ignore an existing checkpoint\n"
          "START and COUNT accept decimal, 0x hex, or 2^N.\n");
}

static uint64_t parse_u64(const char *s) {
  if (std::strncmp(s, "2^", 2) == 0) {
    char *end = nullptr;
    long n = std::strtol(s + 2, &end, 10);
    if (end == s + 2 || *end != '\0' || n < 0 || n >= 64) {
      fprintf(stderr, "bad power: %s\n", s);
      exit(2);
    }
    return 1ull << n;
  }
  char *end = nullptr;
  unsigned long long v = std::strtoull(s, &end, 0);
  if (end == s || *end != '\0') {
    fprintf(stderr, "bad integer: %s\n", s);
    exit(2);
  }
  return (uint64_t)v;
}

static void require_shape(int w, int h) {
  int bits = w * h;
  if (w < 1 || h < 1 || w > MAX_W || h > MAX_H || bits > 64) {
    fprintf(stderr, "board must have 1≤W≤%d, 1≤H≤%d, W*H≤64 (got %d×%d)\n", MAX_W, MAX_H, w, h);
    exit(2);
  }
}

static int verify() {
  uint64_t hist[HIST_BINS];
  uint64_t cpu[HIST_BINS];

  printf("host template vs host runtime on every 4×4 state\n");
  clear_hist(cpu);
  uint64_t drift = 0;
  for (uint64_t s = 0; s < (1ull << 16); ++s) {
    int a = fate_bin<4, 4>(s);
    int b = fate_bin_rt(4, 4, s);
    if (a != b) ++drift;
    cpu[a] += 1;
  }
  expect_eq("template/runtime mismatches", drift, 0);
  expect_eq("cpu dies", cpu[BIN_DIES], 33708);
  expect_eq("cpu still lifes", cpu[BIN_STILL], 29268);
  expect_eq("cpu period 2", cpu[BIN_PERIOD + 0], 2512);
  expect_eq("cpu period 3", cpu[BIN_PERIOD + 1], 48);

  printf("\nhost symmetry weights on every 4×4 state\n");
  clear_hist(cpu);
  for (uint64_t s = 0; s < (1ull << 16); ++s) {
    int weight = orbit_weight<4, 4>(s);
    if (weight) cpu[fate_bin<4, 4>(s)] += (uint64_t)weight;
  }
  expect_eq("sym dies", cpu[BIN_DIES], 33708);
  expect_eq("sym still lifes", cpu[BIN_STILL], 29268);
  expect_eq("sym period 2", cpu[BIN_PERIOD + 0], 2512);
  expect_eq("sym period 3", cpu[BIN_PERIOD + 1], 48);
  expect_eq("sym total", hist_total(cpu), 1ull << 16);

  struct Known {
    int n;
    uint64_t dies, stills;
    int periods[4]; // p2, p3, p4, p5; -1 = don't care
    uint64_t pcount[4];
  };
  const Known known[] = {
      {2, 11, 5, {0, 0, 0, 0}, {0, 0, 0, 0}},
      {3, 362, 148, {2, 0, 0, 0}, {2, 0, 0, 0}},
      {4, 33708, 29268, {2, 3, 0, 0}, {2512, 48, 0, 0}},
  };
  for (const Known &k : known) {
    printf("\nGPU sym %d×%d\n", k.n, k.n);
    auto t0 = std::chrono::steady_clock::now();
    run_census(k.n, k.n, 0, 1ull << (k.n * k.n), hist, true);
    double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    print_hist(k.n, k.n, 0, 1ull << (k.n * k.n), hist, sec, "sym");
    expect_eq("dies", hist[BIN_DIES], k.dies);
    expect_eq("still lifes", hist[BIN_STILL], k.stills);
    expect_eq("unresolved", hist[BIN_UNRESOLVED], 0);
    expect_eq("total", hist_total(hist), 1ull << (k.n * k.n));
    for (int i = 0; i < 4; ++i) {
      if (k.periods[i] == 0) continue;
      char label[32];
      std::snprintf(label, sizeof(label), "period %d", k.periods[i]);
      expect_eq(label, hist[BIN_PERIOD + (k.periods[i] - 2)], k.pcount[i]);
    }
  }

  printf("\nGPU sym 3×5 vs 5×3 (transpose)\n");
  uint64_t a[HIST_BINS], b[HIST_BINS];
  run_census(3, 5, 0, 1ull << 15, a, true);
  run_census(5, 3, 0, 1ull << 15, b, true);
  if (!hist_equal(a, b)) {
    ++g_failures;
    printf("  FAIL transpose histograms differ\n");
  } else {
    printf("  ok  histograms match (dies %" PRIu64 ", still %" PRIu64 ", osc %" PRIu64 ")\n",
           a[BIN_DIES], a[BIN_STILL], osc_total(a));
  }
  expect_eq("3×5 total", hist_total(a), 1ull << 15);

  printf("\nGPU runtime path 9×2 vs host runtime\n");
  clear_hist(cpu);
  for (uint64_t s = 0; s < (1ull << 18); ++s) cpu[fate_bin_rt(9, 2, s)] += 1;
  run_census(9, 2, 0, 1ull << 18, hist, false);
  if (!hist_equal(hist, cpu)) {
    ++g_failures;
    printf("  FAIL runtime GPU histogram != host\n");
  } else {
    printf("  ok  %" PRIu64 " states match\n", hist_total(hist));
  }

  printf("\nGPU sym 5×5\n");
  auto t0 = std::chrono::steady_clock::now();
  run_census(5, 5, 0, 1ull << 25, hist, true);
  double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  print_hist(5, 5, 0, 1ull << 25, hist, sec, "sym");
  expect_eq("dies", hist[BIN_DIES], 20768679ull);
  expect_eq("still lifes", hist[BIN_STILL], 9697206ull);
  expect_eq("unresolved", hist[BIN_UNRESOLVED], 0);
  expect_eq("total", hist_total(hist), 1ull << 25);

  if (g_failures) printf("\n%d check(s) failed\n", g_failures);
  else printf("\nall checks passed\n");
  return g_failures ? 1 : 0;
}

template <int W, int H>
void cpu_census(uint64_t start, uint64_t count, uint64_t *hist, bool sym) {
  clear_hist(hist);
  for (uint64_t i = 0; i < count; ++i) {
    uint64_t state = start + i;
    int weight = sym ? orbit_weight<W, H>(state) : 1;
    if (weight) hist[fate_bin<W, H>(state)] += (uint64_t)weight;
  }
}

static void run_cpu(int w, int h, uint64_t start, uint64_t count, uint64_t *hist, bool sym) {
#define CPU_SYM(W, H)                         \
  if (w == W && h == H) {                     \
    cpu_census<W, H>(start, count, hist, sym); \
    return;                                   \
  }
#define CPU_ROW(W) CPU_SYM(W, 1) CPU_SYM(W, 2) CPU_SYM(W, 3) CPU_SYM(W, 4) CPU_SYM(W, 5) CPU_SYM(W, 6) CPU_SYM(W, 7) CPU_SYM(W, 8)
  CPU_ROW(1) CPU_ROW(2) CPU_ROW(3) CPU_ROW(4) CPU_ROW(5) CPU_ROW(6) CPU_ROW(7) CPU_ROW(8)
#undef CPU_ROW
#undef CPU_SYM
  fprintf(stderr, "cpu path supports axes 1..8\n");
  exit(2);
}

// 28 bitwise ops per row: 10 to form the horizontal sums, 18 in the
// vertical full-adder tree. Counted off step() so the ceiling stays honest.
static constexpr int OPS_PER_ROW = 28;
// Bitwise AND/XOR/SHIFT issue on all 128 CUDA cores per SM. The "INT32 is 64"
// rule is for integer multiply; the step microbenchmark sustains ~97% of the
// 128-wide rate, which a 64-wide pipe cannot reach.
static constexpr int INT32_PER_SM_PER_CLOCK = 128;

template <int W, int H>
__global__ void step_bench(uint64_t count, int gens, unsigned long long *sink) {
  constexpr uint32_t mask = (W >= 32) ? 0xffffffffu : ((1u << W) - 1u);
  const uint64_t stride = (uint64_t)gridDim.x * blockDim.x;
  const uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  unsigned long long acc = 0;
  for (uint64_t i = tid; i < count; i += stride) {
    uint32_t buf_a[H], buf_b[H];
#pragma unroll
    for (int y = 0; y < H; ++y)
      buf_a[y] = (uint32_t)((i >> (y * W)) & mask);
    uint32_t *cur = buf_a;
    uint32_t *nxt = buf_b;
    for (int g = 0; g < gens; ++g) {
      step<W, H>(cur, nxt);
      uint32_t *tmp = cur;
      cur = nxt;
      nxt = tmp;
    }
    acc += cur[0];
  }
  atomicAdd(sink, acc);
}

static uint64_t splitmix64(uint64_t x) {
  x += 0x9e3779b97f4a7c15ull;
  uint64_t z = x;
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
  return z ^ (z >> 31);
}

// Generations executed by fate_from: a short period-1/2 probe, then Brent.
template <int W, int H>
int life_steps(uint64_t state) {
  constexpr uint32_t mask = (W >= 32) ? 0xffffffffu : ((1u << W) - 1u);
  uint32_t buf_a[H], buf_b[H], buf_c[H];
#pragma unroll
  for (int y = 0; y < H; ++y)
    buf_a[y] = (uint32_t)((state >> (y * W)) & mask);
  uint32_t *prev = buf_a;
  uint32_t *cur = buf_b;
  uint32_t *nxt = buf_c;
  int steps = 0;
  int guard = BRENT_CAP;
  step<W, H>(prev, cur);
  ++steps;
  --guard;
  if (same<H>(prev, cur) || guard <= 0) return steps;
  for (int i = 0; i < 48 && guard > 0; ++i) {
    step<W, H>(cur, nxt);
    ++steps;
    --guard;
    if (same<H>(nxt, cur) || same<H>(nxt, prev)) return steps;
    uint32_t *tmp = prev;
    prev = cur;
    cur = nxt;
    nxt = tmp;
  }
  uint32_t tort[H], hare_buf[H], spare_buf[H];
#pragma unroll
  for (int y = 0; y < H; ++y) tort[y] = cur[y];
  if (guard <= 0) return -steps;
  step<W, H>(tort, hare_buf);
  ++steps;
  --guard;
  uint32_t *hare = hare_buf;
  uint32_t *spare = spare_buf;
  int power = 1;
  int lam = 1;
  while (!same<H>(tort, hare)) {
    if (guard <= 0) return -steps;
    if (power == lam) {
#pragma unroll
      for (int y = 0; y < H; ++y) tort[y] = hare[y];
      power <<= 1;
      lam = 0;
    }
    step<W, H>(hare, spare);
    ++steps;
    --guard;
    uint32_t *tmp = hare;
    hare = spare;
    spare = tmp;
    ++lam;
  }
  return steps;
}

struct Telemetry {
  int smMHz = 0;
  double watts = 0;
  int tempC = 0;
  bool ok = false;
};

static Telemetry sample_telemetry() {
  Telemetry t;
  FILE *f = popen(
      "nvidia-smi --query-gpu=clocks.sm,power.draw,temperature.gpu --format=csv,noheader,nounits",
      "r");
  if (!f) return t;
  if (fscanf(f, "%d, %lf, %d", &t.smMHz, &t.watts, &t.tempC) == 3) t.ok = true;
  pclose(f);
  return t;
}

template <int W, int H>
double time_launch(bool sym, uint64_t start, uint64_t count, unsigned long long *d) {
  int blocks = pick_blocks(count);
  auto t0 = std::chrono::steady_clock::now();
  if (sym) sym_kernel<W, H><<<blocks, 256>>>(start, count, d);
  else census_kernel<W, H><<<blocks, 256>>>(start, count, d);
  CHECK(cudaGetLastError());
  CHECK(cudaDeviceSynchronize());
  return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
}

// One snapshot of brute vs symmetry, plus the hardware ceiling. The page at
// /projects/gol/benchmarks reads a history of these objects.
static int bench_main() {
  cudaDeviceProp prop{};
  CHECK(cudaGetDeviceProperties(&prop, 0));
  unsigned long long *d = nullptr;
  CHECK(cudaMalloc(&d, HIST_BINS * sizeof(unsigned long long)));
  unsigned long long *sink = nullptr;
  CHECK(cudaMalloc(&sink, sizeof(unsigned long long)));

  fprintf(stderr, "warmup\n");
  time_launch<7, 7>(true, 0, 1ull << 20, d);

  fprintf(stderr, "5×5 full\n");
  const uint64_t n5 = 1ull << 25;
  double brute5 = time_launch<5, 5>(false, 0, n5, d);
  double sym5 = time_launch<5, 5>(true, 0, n5, d);

  // Each 7-bit top row is an equal 2^42-state slice of the 7×7 space.
  // 2^27 states is enough to leave the launch behind on the slow slices
  // and still finish the fast ones in a few milliseconds.
  constexpr int TOPS = 128;
  constexpr uint64_t SLICE = 1ull << 27;
  double sym7[TOPS];
  Telemetry tele[8];
  int tele_n = 0;
  for (int top = 0; top < TOPS; ++top) {
    if (top % 16 == 0) fprintf(stderr, "7×7 symmetry top %d\n", top);
    sym7[top] = time_launch<7, 7>(true, (uint64_t)top << 42, SLICE, d);
    if (top == 0 || top == 15 || top == 64 || top == 127) {
      Telemetry t = sample_telemetry();
      if (t.ok && tele_n < 8) tele[tele_n++] = t;
    }
  }

  const int brute_tops[] = {0, 4, 8, 16, 32, 48, 64, 96, 127};
  double brute7[9];
  fprintf(stderr, "7×7 brute samples\n");
  for (int i = 0; i < 9; ++i)
    brute7[i] = time_launch<7, 7>(false, (uint64_t)brute_tops[i] << 42, SLICE, d);

  fprintf(stderr, "inner-loop step\n");
  const uint64_t step_states = 1ull << 24;
  const int step_gens = 64;
  int blocks = pick_blocks(step_states);
  CHECK(cudaMemset(sink, 0, sizeof(unsigned long long)));
  auto t0 = std::chrono::steady_clock::now();
  step_bench<7, 7><<<blocks, 256>>>(step_states, step_gens, sink);
  CHECK(cudaGetLastError());
  CHECK(cudaDeviceSynchronize());
  double step_sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  Telemetry step_tele = sample_telemetry();
  if (step_tele.ok && tele_n < 8) tele[tele_n++] = step_tele;

  fprintf(stderr, "trajectory sample\n");
  long long minima = 0, steps_min = 0, steps_all = 0, capped = 0, sampled = 0;
  for (int i = 0; i < 20000; ++i) {
    uint64_t state = splitmix64((uint64_t)i) & ((1ull << 49) - 1);
    int steps = life_steps<7, 7>(state);
    if (steps < 0) {
      ++capped;
      steps = -steps;
    }
    ++sampled;
    steps_all += steps;
    if (orbit_weight<7, 7>(state)) {
      ++minima;
      steps_min += steps;
    }
  }

  auto rate_of = [](uint64_t n, double sec) { return sec > 0 ? (double)n / sec : 0.0; };
  double seconds_full = 0;
  for (int top = 0; top < TOPS; ++top) {
    double rate = rate_of(SLICE, sym7[top]);
    seconds_full += (double)(1ull << 42) / rate;
  }
  double sym7_rate = (double)(1ull << 49) / seconds_full;
  double brute7_sum = 0;
  for (double sec : brute7) brute7_sum += rate_of(SLICE, sec);
  double brute7_rate = brute7_sum / 9.0;

  double sm_sum = 0;
  double watt_sum = 0;
  int temp_max = 0;
  for (int i = 0; i < tele_n; ++i) {
    sm_sum += tele[i].smMHz;
    watt_sum += tele[i].watts;
    if (tele[i].tempC > temp_max) temp_max = tele[i].tempC;
  }
  double sm_mhz = tele_n ? sm_sum / tele_n : prop.clockRate / 1000.0;
  double watts = tele_n ? watt_sum / tele_n : 0;

  const double int32_peak = (double)prop.multiProcessorCount * INT32_PER_SM_PER_CLOCK * sm_mhz * 1e6;
  const double gens_peak = int32_peak / (OPS_PER_ROW * 7);
  const double minima_frac = sampled ? (double)minima / (double)sampled : 0;
  const double avg_steps_min = minima ? (double)steps_min / (double)minima : 0;
  const double avg_steps_all = sampled ? (double)steps_all / (double)sampled : 0;
  // Fully optimized census: only orbit minima are stepped, rejects cost nothing,
  // and every integer pipe issues a useful op from step().
  const double ops_per_index = minima_frac * avg_steps_min * (OPS_PER_ROW * 7);
  const double ceiling = ops_per_index > 0 ? int32_peak / ops_per_index : 0;
  const double step_gens_per_sec = step_sec > 0 ? (double)step_states * step_gens / step_sec : 0;
  const double step_ops = step_gens_per_sec * (OPS_PER_ROW * 7);
  // Same work, but using the step throughput the hardware just demonstrated
  // rather than the architectural issue peak.
  const double practical = (ops_per_index > 0 && step_gens_per_sec > 0)
                               ? step_gens_per_sec / (minima_frac * avg_steps_min)
                               : 0;
  const double mem_clock_hz = (double)prop.memoryClockRate * 1000.0;
  const double mem_bytes = (prop.memoryBusWidth / 8.0) * (mem_clock_hz * 2.0);

  printf("{\n");
  printf("  \"device\": \"%s\",\n", prop.name);
  printf("  \"computeCapability\": \"%d.%d\",\n", prop.major, prop.minor);
  printf("  \"sms\": %d,\n", prop.multiProcessorCount);
  printf("  \"smClockBaseMHz\": %d,\n", prop.clockRate / 1000);
  printf("  \"smClockSustainedMHz\": %.0f,\n", sm_mhz);
  printf("  \"powerWatts\": %.1f,\n", watts);
  printf("  \"tempC\": %d,\n", temp_max);
  printf("  \"memoryBusBits\": %d,\n", prop.memoryBusWidth);
  printf("  \"memoryClockMHz\": %.0f,\n", mem_clock_hz / 1e6);
  printf("  \"memoryBandwidthGBps\": %.1f,\n", mem_bytes / 1e9);
  printf("  \"int32PerSmPerClock\": %d,\n", INT32_PER_SM_PER_CLOCK);
  printf("  \"opsPerRow\": %d,\n", OPS_PER_ROW);
  printf("  \"opsPerGeneration7\": %d,\n", OPS_PER_ROW * 7);
  printf("  \"minimaFraction\": %.6f,\n", minima_frac);
  printf("  \"avgStepsOnMinima\": %.3f,\n", avg_steps_min);
  printf("  \"avgStepsAllStates\": %.3f,\n", avg_steps_all);
  printf("  \"cappedTrajectories\": %lld,\n", capped);
  printf("  \"trajectorySamples\": %lld,\n", sampled);
  printf("  \"int32PeakOps\": %.6e,\n", int32_peak);
  printf("  \"issueCeilingStatesPerSec\": %.6e,\n", ceiling);
  printf("  \"practicalCeilingStatesPerSec\": %.6e,\n", practical);
  printf("  \"memoryCeilingStatesPerSec\": %.6e,\n", mem_bytes / 8.0);
  printf("  \"generationsPeakPerSec\": %.6e,\n", gens_peak);
  printf("  \"innerGenerationsPerSec\": %.6e,\n", step_gens_per_sec);
  printf("  \"innerOpsPerSec\": %.6e,\n", step_ops);
  printf("  \"innerFractionOfPeak\": %.4f,\n", int32_peak > 0 ? step_ops / int32_peak : 0);
  printf("  \"brute5StatesPerSec\": %.6e,\n", rate_of(n5, brute5));
  printf("  \"sym5StatesPerSec\": %.6e,\n", rate_of(n5, sym5));
  printf("  \"brute5Seconds\": %.4f,\n", brute5);
  printf("  \"sym5Seconds\": %.4f,\n", sym5);
  printf("  \"brute7StatesPerSec\": %.6e,\n", brute7_rate);
  printf("  \"sym7StatesPerSec\": %.6e,\n", sym7_rate);
  printf("  \"brute7Samples\": [\n");
  for (int i = 0; i < 9; ++i) {
    printf("    {\"top\": %d, \"statesPerSec\": %.6e}%s\n", brute_tops[i], rate_of(SLICE, brute7[i]), i == 8 ? "" : ",");
  }
  printf("  ],\n");
  printf("  \"sym7Strata\": [\n");
  for (int top = 0; top < TOPS; ++top) {
    printf("    {\"top\": %d, \"statesPerSec\": %.6e}%s\n", top, rate_of(SLICE, sym7[top]), top == TOPS - 1 ? "" : ",");
  }
  printf("  ]\n");
  printf("}\n");

  CHECK(cudaFree(d));
  CHECK(cudaFree(sink));
  return 0;
}

int main(int argc, char **argv) {
  std::setvbuf(stdout, nullptr, _IOLBF, 0);
  bool force_sym = false;
  bool force_brute = false;
  bool use_cpu = false;
  bool json = false;
  bool fresh = false;
  const char *ckpt_path = nullptr;
  int argi = 1;
  while (argi < argc && argv[argi][0] == '-') {
    if (std::strcmp(argv[argi], "--verify") == 0) return verify();
    if (std::strcmp(argv[argi], "--bench") == 0) return bench_main();
    if (std::strcmp(argv[argi], "--sym") == 0) force_sym = true;
    else if (std::strcmp(argv[argi], "--brute") == 0) force_brute = true;
    else if (std::strcmp(argv[argi], "--cpu") == 0) use_cpu = true;
    else if (std::strcmp(argv[argi], "--json") == 0) json = true;
    else if (std::strcmp(argv[argi], "--fresh") == 0) fresh = true;
    else if (std::strcmp(argv[argi], "--checkpoint") == 0) {
      if (argi + 1 >= argc) {
        usage();
        return 2;
      }
      ckpt_path = argv[++argi];
    } else {
      usage();
      return 2;
    }
    ++argi;
  }
  int nargs = argc - argi;
  if (nargs != 2 && nargs != 4) {
    usage();
    return 2;
  }
  int w = std::atoi(argv[argi]);
  int h = std::atoi(argv[argi + 1]);
  require_shape(w, h);
  int bits = w * h;
  uint64_t start = 0;
  uint64_t count = 0;
  bool sliced = nargs == 4;
  if (sliced) {
    start = parse_u64(argv[argi + 2]);
    count = parse_u64(argv[argi + 3]);
  } else if (bits >= 64) {
    fprintf(stderr, "%d×%d has 2^64 states; pass START and COUNT\n", w, h);
    return 2;
  } else {
    count = 1ull << bits;
  }
  if (count == 0 || count > ~start) {
    fprintf(stderr, "range [%" PRIu64 ", +%" PRIu64 ") does not fit in uint64\n", start, count);
    return 2;
  }

  bool full = !sliced;
  bool sym = force_sym || (full && !force_brute && h > 1 && w <= 8 && h <= 8);
  if (force_brute) sym = false;
  if (sym && (w > 8 || h > 8 || h < 2)) {
    fprintf(stderr, "symmetry path supports 2..8 on each axis\n");
    return 2;
  }
  if (sym && !full) {
    fprintf(stderr, "warning: --sym on a slice weights whole orbits; the histogram is not the census of that slice\n");
  }

  const char *mode = use_cpu ? (sym ? "cpu sym" : "cpu brute") : (sym ? "sym" : "brute");
  if (!use_cpu && !json) {
    cudaDeviceProp prop{};
    CHECK(cudaGetDeviceProperties(&prop, 0));
    fprintf(stderr, "%s\n", prop.name);
  }

  uint64_t hist[HIST_BINS];
  clear_hist(hist);
  uint64_t origin = start;
  double elapsed_base = 0;
  bool seeded = false;
  if (json && ckpt_path && !fresh && read_ckpt(ckpt_path, w, h, &origin, &elapsed_base, hist)) {
    if (origin < start || origin > start + count) {
      fprintf(stderr, "checkpoint index %" PRIu64 " is outside [%" PRIu64 ", %" PRIu64 ")\n", origin, start, start + count);
      return 2;
    }
    seeded = origin > start;
    fprintf(stderr, "resuming %d×%d at %" PRIu64 "\n", w, h, origin);
  }
  uint64_t remain = count - (origin - start);
  // A json census of a full board reports 2^(W*H) as `total`. A slice reports the slice.
  uint64_t reported_total = full && bits < 64 ? (1ull << bits) : count;

  if (remain == 0) {
    if (json) print_census_json("result", w, h, origin, reported_total, hist, elapsed_base, 0, full && origin == reported_total);
    else print_hist(w, h, start, count, hist, elapsed_base, mode);
    if (ckpt_path) std::remove(ckpt_path);
    return 0;
  }

  ProgressCtl prog;
  prog.json = json;
  prog.w = w;
  prog.h = h;
  prog.origin = origin;
  prog.total = reported_total;
  prog.elapsed_base = elapsed_base;
  prog.t0 = std::chrono::steady_clock::now();
  prog.ckpt = ckpt_path;

  auto t0 = prog.t0;
  if (use_cpu) run_cpu(w, h, origin, remain, hist, sym);
  else run_census(w, h, origin, remain, hist, sym, seeded ? hist : nullptr, json ? &prog : nullptr);
  double session = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  double sec = elapsed_base + session;
  if (json) {
    double rate = session > 0 ? (double)remain / session : 0;
    bool done = full && origin + remain == reported_total;
    print_census_json("result", w, h, origin + remain, reported_total, hist, sec, rate, done);
    if (done && ckpt_path) std::remove(ckpt_path);
  } else {
    print_hist(w, h, start, count, hist, sec, mode);
  }
  if (!sym || full) {
    if (hist_total(hist) != count) {
      fprintf(stderr, "total %" PRIu64 " != count %" PRIu64 "\n", hist_total(hist), count);
      return 1;
    }
  }
  return 0;
}
