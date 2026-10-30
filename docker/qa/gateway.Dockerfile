FROM python:3.13-alpine
WORKDIR /app
COPY docker/qa/gateway.py /app/gateway.py
USER 65532:65532
EXPOSE 8080
CMD ["python", "/app/gateway.py"]
