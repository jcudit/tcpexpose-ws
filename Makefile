AUTHOR = jcudit
PROJECT = tcpexpose-ws
VERSION = 2016.12.0
CONTAINER_NAME = $(AUTHOR)/$(PROJECT):$(VERSION)
INSTANCE_NAME = $(PROJECT)
RUN_OPTS = --rm

DEPS = $(shell find *.js -type f -print)

all: build

build: . $(DEPS)
	docker build -t $(CONTAINER_NAME) .

run: build stop
	docker run -d --name=$(INSTANCE_NAME) $(RUN_OPTS) $(CONTAINER_NAME)

stop:
	docker stop $(INSTANCE_NAME)

help:
	@fgrep -h "##" $(MAKEFILE_LIST) | fgrep -v fgrep | sed -e 's/\\$$//' | sed -e 's/##//'

.PHONY: build run stop help
