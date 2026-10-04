NVCC ?= nvcc
ARCH ?= sm_86

gol-census: gol_census.cu
	$(NVCC) -O3 -std=c++17 -arch=$(ARCH) -o gol-census gol_census.cu

clean:
	rm -f gol-census
