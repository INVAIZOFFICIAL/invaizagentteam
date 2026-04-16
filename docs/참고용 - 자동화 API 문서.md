# 참고용 - 자동화 API 문서

# [업데이트 내역](https://www.notion.so/3119cd201d158017a58fd0028c87fdd8?pvs=21)

# 공통 요청 양식

```bash
Content-Type: application/json
x-api-key: <your-api-key>
```

```bash
[POST] https://dayzero-api.invaiz.com/v1/automation-client/run/{ID or Alias}
```

- 모든 API의 헤더는 아래와 같습니다.
- API Key는 미리 발급 받은 API를 사용합니다.

<aside>
1️⃣

## 🎁 한 카테고리 상품 리스트 가져오기

1. 각 요청 시, 카테고리 상품 리스트를 나타내는 URL을 `url` 데이터로 포함하여 요청합니다.
2. 모든 한 카테고리 상품 리스트 가져오기 API의 요청 형식은 아래와 같습니다.
    
    ```json
    {
    	"parameters": {
    		"url": "상품 리스트 URL",
    		"numberOfProducts": 가져올 상품 수, // optional
    	}
    }
    ```
    
    - 상품 리스트 URL은 해당 API 서비스 **상품의 리스트가 포함된 URL을 전송**합니다.
    - `numberOfProducts`를 지원하는 상품의 경우, 가져올 상품의 갯수를 지정할 수 있습니다.

</aside>

<aside>
2️⃣

## 🎁 상품 정보 가져오기 API

1. 각 문서 상단의 “요청 ID 및 URL”을 보고, 요청 URL에 `productUrl` 데이터를 포함하여 요청합니다.
2. 응답 값은 특정 상품을 직접 요청하여 받아낸 예시이며, 모든 상품에 대해 변동이 없는 값은 📌가, **구매 자동화에 필요한 값은 ⭐**가 옆에 표현되어 있습니다.
3. 모든 상품 정보 가져오기 API의 요청 형식은 아래와 같습니다.
    
    ```json
    {
    	"parameters": {
    		"productUrl": "제품의 URL"
    	}
    }
    ```
    
    - 제품 URL은 해당 API 서비스 상품의 **상세 페이지 URL을 전송**합니다.

</aside>

<aside>
3️⃣

## 💸 구매 API

1. 모든 구매 API는 DayZero Automation Agent에서 **웹사이트 로그인 및 카드번호 입력이 필요**합니다.
    
    ![로그인 및 카드번호 입력 정보](%EC%B0%B8%EA%B3%A0%EC%9A%A9%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image.png)
    
    로그인 및 카드번호 입력 정보
    
2. 모든 구매 API의 요청에는 **배송지 상세 주소가 포함**되어 있습니다.
    
    ```json
    {
    	"parameters": {
    		// ...
    		deliveryAddress: "배송지 상세 주소"
    		// ...
    	}
    }
    ```
    
    - **배송지 상세 주소**는 일반적으로 주소를 기입할 때 **마지막에 입력하는 ‘상세 주소’를 입력**하시면 됩니다.
    
    > **예시)** 부산광역시 사하구 낙동대로 550번길 37, S14-411호 → `deliveryAddress: S14-411호`
    > 
3. 모든 구매 API의 응답은 다음과 같습니다.
    
    ```json
    {
      "queueId": 큐 번호,
      "status": "WAITING",
      "message": "이 작업이 성공적으로 대기열에 추가되었습니다."
    }
    ```
    
4. 구매 API는 Queue에 들어간 후, 일정 시간 뒤에 동작하므로 실제로는 관리자 페이지에서 결과 및 주문번호를 조회할 수 있습니다.
    - 구매 API의 결과를 획득하기 위해서는 Webhook을 등록한 후 결과를 수신해야 합니다.
    - 구매 API의 **성공 응답**은 각 **자동화 예시 페이지 내에 구매 응답**을, **실패 응답**은 [**🚨 에러 코드 문서**](https://www.notion.so/API-2ca9cd201d1580dba2ddef6c757f397e?pvs=21)를 확인하시면 됩니다.
    - **Webhook 등록 방법**에 대해서는 [**📩](https://www.notion.so/API-28d9cd201d15803a9192cc5b316521ba?pvs=21) [Webhook(콜백 메시지) 문서](https://www.notion.so/API-2ca9cd201d1580dba2ddef6c757f397e?pvs=21)**를 참고해주세요.
5. 구매 API를 클라이언트에서 실행시키기 위해서는, **한 가지 보안 프로그램만 설치**되어야 합니다.
    
    
    - **설치되어야 하는 보안 프로그램**은 `IPinside` 입니다.
        
        ![전자금융거래 보안프로그램(`IPinside`) 설치 필요](%EC%B0%B8%EA%B3%A0%EC%9A%A9%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%201.png)
        
        전자금융거래 보안프로그램(`IPinside`) 설치 필요
        
    
    - 해당 클라이언트에 **“키보드 보안프로그램(`nProtect Online Security`)”**가 **설치되어 있으면 안됩니다.**
        
        ![해당 창이 뜬 후 가상키패드를 사용해야만 자동화가 가능합니다.](%EC%B0%B8%EA%B3%A0%EC%9A%A9%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%202.png)
        
        해당 창이 뜬 후 가상키패드를 사용해야만 자동화가 가능합니다.
        
</aside>

---

# 📩 Webhook(콜백 메시지) 문서

<aside>
1️⃣

## 🤔 Webhook 등록 방법

### 1. [https://dayzero-dashboard.invaiz.com/settings](https://dayzero-dashboard.invaiz.com/settings) 대시보드에 접속하여 설정 페이지로 이동합니다.

![대시보드 접속 후 상단에 설정 페이지로 이동](%EC%B0%B8%EA%B3%A0%EC%9A%A9%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%203.png)

대시보드 접속 후 상단에 설정 페이지로 이동

### 2. 설정 페이지에서 웹훅을 추가하거나 관리할 수 있습니다.

![설정 페이지에서 웹훅 추가/관리 가능](%EC%B0%B8%EA%B3%A0%EC%9A%A9%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%204.png)

설정 페이지에서 웹훅 추가/관리 가능

### 3. HTTP Webhook 등록 시 헤더를 함께 첨부할 수 있습니다.

![HTTP Webhook에서는 커스텀 헤더를 설정할 수 있으며 테스트 가능](%EC%B0%B8%EA%B3%A0%EC%9A%A9%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%205.png)

HTTP Webhook에서는 커스텀 헤더를 설정할 수 있으며 테스트 가능

### 4. Slack Webhook 등록 시 메시지 양식은 정해져있습니다.

</aside>

<aside>
2️⃣

## 📋 HTTP Webhook 문서 양식

```json
{
  automationId: "자동화 ID";
  queueId?: Queue 실행의 경우 할당 받은 ID; // optional
  request: {}; // 자동화 요청 시 함께 전송한 데이터
  response: {}; // 자동화 결과 값(성공/실패 포함)
  occurredAt: Date; // 전송 시각
}
```

</aside>

<aside>
💡

### 주의 사항

- 콜백 메시지는 API로 요청한 자동화의 ‘성공’ 케이스에는 메시지가 발송되지 않습니다.
1. API의 실패
2. Queue의 성공/실패
3. Scheduled의 성공/실패
</aside>

## 🧪 테스트 API 요청하기

- 테스트 API를 보내려면 일반적으로 요청하는 방법과 동일한 헤더를 첨부합니다.

```bash
Content-Type: application/json
x-api-key: <your-api-key>
```

```bash
[POST] https://dayzero-api.invaiz.com/v1/automation-client/test/{ID or Alias}
```

```json
{
	"parameters": { // 테스트 할 자동화에 첨부할 파라미터
    // "productUrl": "URL"
	},
	"output": { // 자동화의 결과값으로 기대하는 테스트 데이터
    // "orderNumber": "주문번호",
    // "productAmount": 1000,
    // "discountAmount": 900,
    // "deliveryFee": 100,
    // "totalAmount": 1000,
    // "paymentMethod": "결제수단",
    // "recipientName": "받는분",
    // "address": "주소"
	}
}
```

- 요청 URL의 마지막 세그먼트에는 테스트 실행할 자동화의 ID나 Alias를 첨부합니다.
    - `run` → `test`만 다르다고 볼 수 있습니다.
- Body에는 실제로 실행하는 데이터를 첨부합니다.
- `parameters`외에 `output`도 추가로 첨부할 수 있습니다.
    - `output`은 테스트가 실행된 후 기대하는 결과 값을 넣으며, API 응답 값으로 반환됩니다.

---

# 🔗 구매 - Webhook 연동 방법

## 1. 관리자 대시보드에서 HTTP Webhook을 연동합니다.

![커스텀 헤더를 포함하여 생성하기](../%EC%A0%84%EC%B2%B4/ecd822ed2f934fbdb08e94bc6090ad63/INVAIZ%202%200%20Database/Memo/%EA%B0%9C%EB%B0%9C%20%EB%AC%B8%EC%84%9C/%EB%94%9C%EB%A6%AC%EB%B2%84%EB%93%9C%20%EC%BD%94%EB%A6%AC%EC%95%84%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image.png)

커스텀 헤더를 포함하여 생성하기

![모든 내용 알림 받기](../%EC%A0%84%EC%B2%B4/ecd822ed2f934fbdb08e94bc6090ad63/INVAIZ%202%200%20Database/Memo/%EA%B0%9C%EB%B0%9C%20%EB%AC%B8%EC%84%9C/%EB%94%9C%EB%A6%AC%EB%B2%84%EB%93%9C%20%EC%BD%94%EB%A6%AC%EC%95%84%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%201.png)

모든 내용 알림 받기

- Webhook은 POST Method로 전송되며, 사용자 지정 헤더를 포함할 수 있습니다.
    - 보안을 위해 **사용자 지정 헤더를 포함하는 것을 권장**드립니다.
- 구매 성공의 경우까지 모든 결과를 처리하기 위해서는 **‘모든 내용 알림’**으로 선택하여 Webhook을 생성합니다.
- Webhook 테스트 시 받는 응답은 아래와 같습니다.
    
    ```bash
    headers {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      Auth: 'AuthKey',
      'user-agent': 'axios/1.13.5',
      'content-length': '148',
      'accept-encoding': 'gzip, compress, deflate, br',
      host: 'dayzero-api.invaiz.com',
      connection: 'keep-alive'
    }
    body {
      automationId: 'test-automation',
      queueId: 123,
      request: { test: 'request' },
      response: { test: 'response' },
      occurredAt: '2026-02-25T09:59:10.703Z'
    }
    ```
    

## 2. 구매 API 요청을 통해 자동화 대기 큐에 구매 요청을 등록합니다.

- DDK Automation Agent에서 구매 요청할 서비스에 로그인 한 후, API를 전송하여 구매 요청을 등록합니다.
    
    ```bash
    curl -X 'POST' \
      'http://dayzero-api.invaiz.com/v1/automation-client/run/daiso-mall-order' \
      -H 'accept: application/json' \
      -H 'x-api-key: <API_KEY>' \
      -H 'Content-Type: application/json' \
      -d '{
      "parameters": {
        "product": {
          "count": 0,
          "isBox": false,
          "options": [
            {
              "count": 2,
              "optionValueName": "핑크_짱구(흰둥이)"
            }
          ],
          "productName": "짱구 자수 장목 양말"
        },
        "productUrl": "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1044699",
        "deliveryAddress": "Daiso mall"
      }
    }'
    ```
    
    ```json
    {
      "queueId": 1177,
      "status": "WAITING",
      "message": "이 작업이 성공적으로 대기열에 추가되었습니다."
    }
    ```
    
    ![구매 요청 등록 시 대시보드에서 확인 가능](../%EC%A0%84%EC%B2%B4/ecd822ed2f934fbdb08e94bc6090ad63/INVAIZ%202%200%20Database/Memo/%EA%B0%9C%EB%B0%9C%20%EB%AC%B8%EC%84%9C/%EB%94%9C%EB%A6%AC%EB%B2%84%EB%93%9C%20%EC%BD%94%EB%A6%AC%EC%95%84%20-%20%EC%9E%90%EB%8F%99%ED%99%94%20API%20%EB%AC%B8%EC%84%9C/image%202.png)
    
    구매 요청 등록 시 대시보드에서 확인 가능
    
- 구매 요청 등록 시 관리자 페이지에 대기중으로 표시되는 것을 확인할 수 있습니다.
- 이렇게 대기중인 자동화는 자동화 컴퓨터 중 실행 가능한 컴퓨터가 있을 때 순서대로 실행됩니다.

## 3. 연동된 Webhook Endpoint에서 결과 데이터를 수신하여 처리합니다.

- 결과가 나타나게 되면 등록했던 Webhook으로 결과 데이터가 송신됩니다.

```json
{
	"accept": "application/json, text/plain, */*",
	"content-type": "application/json",
	"auth": "AuthKey",
	"user-agent": "axios/1.13.5",
	"content-length": "1565",
	"accept-encoding": "gzip, compress, deflate, br",
	"host": "dayzero-api.invaiz.com",
	"connection": "keep-alive"
}
```

```json
{
	"automationId": "자동화 ID",
	"queueId": 1177,
	"request": {
		"parameters": {
			"product": {
	      "count": 0,
	      "isBox": false,
	      "options": [
	        {
	          "count": 2,
	          "optionValueName": "핑크_짱구(흰둥이)"
	        }
	      ],
	      "productName": "짱구 자수 장목 양말"
	    },
			"productUrl": "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1044699",
			"deliveryAddress": "Daiso mall"
		}
	},
	"response": {
	  "orderNumber": "000011110000",
	  "recipientName": "테스트 이름",
	  "address": "테스트 주소",
	  "totalAmount": 5000,
	  "productAmount": 2000,
	  "deliveryFee": 3000,
	  "paymentMethod": "삼성카드 ****-****-****-****"
	},
	"occurredAt": "2026-02-25T10:18:14.106Z"
}
```

```json
{
	"automationId": "자동화 ID",
	"queueId": 1177,
	"request": {
		"parameters": {
			"product": {
	      "count": 0,
	      "isBox": false,
	      "options": [
	        {
	          "count": 2,
	          "optionValueName": "핑크_짱구(흰둥이)"
	        }
	      ],
	      "productName": "짱구 자수 장목 양말"
	    },
			"productUrl": "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1044699",
			"deliveryAddress": "Daiso mall"
		}
	},
	"response": {
		"message": "'.option-box .el-input__inner, .option-select .el-input__inner' 웹 요소를 찾을 수 없습니다.",
		"cause": {
			"code": "ERR-W3",
			"details": {
			  "work": {
			    "id": "wait-visible-contents",
			    "action": {
			      "_tag": "web:wait-visible",
			      "target": {
			        "_tag": "web:element",
			        "handleId": "browser:www.daisomall.co.kr",
			        "selector": ".option-box .el-input__inner, .option-select .el-input__inner"
			      },
			      "postStrategy": {}
			    },
			    "failure_mode": "strict"
			  },
			  "context": {
			    "memory": {
			      "product": {
			        "_tag": "memory",
			        "value": {
			          "count": 0,
			          "isBox": false,
			          "options": [
			            {
			              "count": 2,
			              "optionValueName": "핑크_짱구(흰둥이)"
			            }
			          ],
			          "productName": "짱구 자수 장목 양말"
			        }
			      },
			      "productUrl": {
			        "_tag": "memory",
			        "value": "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1044699"
			      },
			      "deliveryAddress": {
			        "_tag": "memory",
			        "value": "Daiso mall"
			      }
			    },
			    "output": {}
			  },
			  "information": {
			    "_tag": "TimeoutException"
			  }
			}
		}
	},
	"occurredAt": "2026-02-25T10:18:14.106Z"
}
```

- 이 결과 데이터를 토대로 성공/실패 여부를 제어하실 수 있습니다.

---

# 🚨 에러 코드 문서

<aside>
1️⃣

## 📋 에러 코드 양식

```json
{
	"message": "에러 메시지",
	"cause": {
		"code": "에러 코드", // 없는 경우도 있음
		"work": {}, // 실패한 작업 정보
		"details": {}, // ... 그 외 정보
	}
}
```

</aside>

<aside>
2️⃣

## 📋 에러 코드 모아보기

## 400 코드 - 잘못된 요청 형식 / 실행할 수 없는 자동화 / 자동화 실행 도중 실패

### 1. 통신 규격 에러

1. 잘못된 형식으로 호출
2. API로 실행할 수 없는 자동화(DIRECT, SCHEDULE)

### 2. 작업 에러

- 일반 작업 에러 (ERR-W1 ~ ERR-W23)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1 | 브라우저를 찾을 수 없습니다 |
    | ERR-W2 | 지정된 URL로 페이지 이동에 실패했습니다 |
    | ERR-W3 | 지정된 웹 요소를 페이지에서 찾을 수 없습니다 |
    | ERR-W4 | 사라져야 할 웹 요소가 여전히 화면에 표시되고 있습니다 |
    | ERR-W5 | 웹 요소에 텍스트 입력을 실패했습니다 |
    | ERR-W6 | 드롭다운 메뉴에서 옵션 선택을 실패했습니다 |
    | ERR-W7 | JavaScript 코드 실행 중 오류가 발생했습니다 |
    | ERR-W8 | 웹 요소에서 데이터 추출을 실패했습니다 |
    | ERR-W9 | 추출한 데이터의 파싱(변환) 작업을 실패했습니다 |
    | ERR-W10 | 지정된 방식으로 데이터 생성을 실패했습니다 |
    | ERR-W11 | 웹 요소의 개수를 확인하는 중 오류가 발생했습니다 |
    | ERR-W12 | 데이터가 정의된 JSON 스키마 형식과 일치하지 않습니다 |
    | ERR-W13 | OCR 작업 환경 초기화를 실패했습니다 |
    | ERR-W14 | OCR 작업 환경 설정 값 적용을 실패했습니다 |
    | ERR-W15 | OCR을 통한 텍스트 인식 작업을 실패했습니다 |
    | ERR-W16 | 페이지 또는 웹 요소의 스크린샷 캡처를 실패했습니다 |
    | ERR-W17 | OCR로 인식 가능한 텍스트를 웹 요소에서 찾을 수 없습니다 |
    | ERR-W18 | OCR로 클릭할 대상 텍스트를 찾을 수 없습니다 |
    | ERR-W19 | 웹 요소에 문자열을 안전하게 입력하는 것을 실패했습니다 |
    | ERR-W20 | 입력된 값이 예상했던 값과 일치하지 않습니다 |
    | ERR-W21 | 브라우저의 스크린샷을 캡쳐하지 못했습니다 |
    | ERR-W22 | 캡쳐한 스크린샷을 업로드하지 못했습니다 |
    | ERR-W23 | 스크린샷 업로드 반환 타입이 올바르지 않습니다 |
- PG사 공통 에러 (ERR-W101 ~ ERR-W114)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W101 | 결제 대행사(PG) 결제 창을 찾을 수 없습니다 |
    | ERR-W102 | 결제 대행사(PG) 결제 창의 URL이 예상된 URL과 다릅니다 |
    | ERR-W103 | 토스페이먼츠에서 카드 더보기를 클릭하지 못했습니다 |
    | ERR-W104 | 토스페이먼츠에서 삼성카드 결제 페이지로의 이동을 실패했습니다 |
    | ERR-W105 | 결제 약관 전체 동의 버튼 클릭을 실패했습니다 |
    | ERR-W106 | 삼성카드 결제 화면 열기를 실패했습니다 |
    | ERR-W107 | 결제 카드로 삼성카드 선택을 실패했습니다 |
    | ERR-W108 | NHN KCP 결제 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W109 | 삼성카드 할부 개월 수 선택을 실패했습니다 |
    | ERR-W110 | 카드 정보 직접 입력 모드로의 전환을 실패했습니다 |
    | ERR-W111 | NHN KCP 결제 요청 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W112 | 결제 요청 버튼 클릭을 실패했습니다 |
    | ERR-W113 | 쿠폰 사용 팝업을 처리하지 못했습니다. |
    | ERR-W114 | 카드 포인트 안내 팝업을 처리하지 못했습니다. |
- 삼성카드 결제 에러 (ERR-W201~ ERR-W213)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W201 | 삼성카드 결제 프레임(iframe)을 찾을 수 없습니다 |
    | ERR-W202 | 삼성카드 결제수단 선택 버튼이 로드되지 않았습니다 |
    | ERR-W203 | 일반 결제 방식 선택 버튼 클릭을 실패했습니다 |
    | ERR-W204 | 삼성카드 VBV(Verified by Visa) 결제 페이지로의 이동을 실패했습니다 |
    | ERR-W205 | 보안 프로그램 설치 안내 팝업 닫기 버튼을 찾을 수 없습니다 |
    | ERR-W206 | 보안 프로그램 설치 안내 팝업 닫기 버튼 클릭을 실패했습니다 |
    | ERR-W207 | 가상 키보드 입력 옵션이 활성화되지 않았습니다 |
    | ERR-W208 | 가상 키보드 입력 모드로의 전환을 실패했습니다 |
    | ERR-W209 | 가상 키패드 팝업이 열리지 않았습니다 |
    | ERR-W210 | 가상 키패드를 통한 카드 번호 입력을 실패했습니다 |
    | ERR-W211 | 삼성카드 최종 결제하기 버튼 클릭을 실패했습니다 |
    | ERR-W212 | 삼성카드 기명/법인 카드 여부 확인 중 오류가 발생했습니다 |
    | ERR-W213 | 카드 번호 입력 후 키패드가 사라지지 않았습니다. |
- 에이전트 상태 및 공통 에러 (ERR-W1001 ~ ERR-W1005)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1001 | 에이전트의 로그인 정보를 가져오는 데에 실패했습니다. |
    | ERR-W1002 | 에이전트가 해당 서비스에 로그인되어 있지 않습니다. |
    | ERR-W1003 | 해당 서비스에서 구매할 상품이 명시되지 않았습니다. |
    | ERR-W1004 | 품절 여부 확인하는 도중 문제가 발생했습니다 |
    | ERR-W1005 | 구매할 상품이 품절되었습니다 |

- Ktown4u 쇼핑몰 에러 (ERR-W1101)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1101 | Ktown4u에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W1102 | Ktown4u에서 상품 번호를 추출하지 못했습니다 |
    | ERR-W1103 | Ktown4u에서 장바구니 담기에 실패했습니다 |
    | ERR-W1104 | Ktown4u에서 장바구니 이동하는 도중 오류가 발생했습니다 |
    | ERR-W1105 | Ktown4u에서 장바구니로 이동하지 못했습니다 |
    | ERR-W1106 | Ktown4u에서 장바구니 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W1107 | Ktown4u에서 장바구니 정리 대상 상품을 찾지 못했습니다 |
    | ERR-W1108 | Ktown4u에서 장바구니 정리 대상 상품의 타입이 올바르지 않습니다 |
    | ERR-W1109 | Ktown4u 장바구니 상품 삭제에 실패했습니다. |
    | ERR-W1110 | Ktown4u 장바구니 상품 삭제 후처리 도중 문제가 발생했습니다 |
- G마켓 쇼핑몰 에러 (ERR-W1201 ~ ERR-W1206)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1201 | G마켓에서 기본 상품 옵션 선택을 실패했습니다 |
    | ERR-W1202 | G마켓에서 조합형 상품 옵션 선택을 실패했습니다 |
    | ERR-W1203 | G마켓에서 텍스트 입력형 옵션 입력을 실패했습니다 |
    | ERR-W1204 | G마켓에서 추가 옵션 선택을 실패했습니다 |
    | ERR-W1205 | G마켓 추가 옵션 선택 팝업 열기를 실패했습니다 |
    | ERR-W1206 | G마켓 추가 옵션 선택 후 팝업 닫기를 실패했습니다 |
- 네이버 스마트스토어 에러 (ERR-W3101 ~ ERR-W1309)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1301 | 네이버 스마트스토어 페이지 로딩을 실패했습니다 |
    | ERR-W1302 | 네이버 스마트스토어 접근 시 캡차 인증이 요구됩니다 |
    | ERR-W1303 | 네이버 스마트스토어 진입 중 오류 페이지가 표시되었습니다 |
    | ERR-W1304 | 네이버 스마트스토어 진입 중 페이지를 찾을 수 없음(404) 오류가 발생했습니다 |
    | ERR-W1305 | 네이버 스마트스토어 캡차 화면이 정상적으로 로드되지 않았습니다 |
    | ERR-W1306 | 네이버 스마트스토어 쿠키 데이터 초기화를 실패했습니다 |
    | ERR-W1307 | 네이버 스마트스토어에서 상품 옵션 영역을 찾을 수 없습니다 |
    | ERR-W1308 | 네이버 스마트스토어에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W1309 | 네이버 스마트스토어에서 추가 상품 선택 및 수량 설정을 실패했습니다 |
- FANS 쇼핑몰 에러 (ERR-W1401 ~ ERR-W1416)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1401 | FANS에서 상품 옵션 선택 창을 열지 못했습니다 |
    | ERR-W1402 | FANS에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W1403 | FANS에서 상품 수량 조절을 실패했습니다 |
    | ERR-W1404 | FANS에서 현재 입력된 상품 수량 확인을 실패했습니다 |
    | ERR-W1405 | FANS에서 입력된 상품 수량이 설정하려던 수량과 다릅니다 |
    | ERR-W1406 | FANS 상품 페이지로 이동하지 못했습니다 |
    | ERR-W1407 | FANS 상품 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W1408 | FANS 상품 옵션 모달을 열지 못했습니다 |
    | ERR-W1409 | FANS 상품 옵션 모달이 정상적으로 로드되지 않았습니다 |
    | ERR-W1410 | FANS 장바구니 담기 버튼을 클릭하지 못했습니다 |
    | ERR-W1411 | FANS 장바구니 담기 완료 메시지가 나타나지 않았습니다 |
    | ERR-W1412 | FANS 장바구니 페이지로 이동하지 못했습니다 |
    | ERR-W1413 | FANS 장바구니 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W1414 | FANS 상품을 장바구니에서 선택하지 못했습니다 |
    | ERR-W1415 | FANS 새로운 상품 옵션을 적용하지 못했습니다 |
    | ERR-W1416 | FANS 상품 옵션 적용 도중 문제가 발생했습니다 |
- 알라딘 쇼핑몰 에러 (ERR-W1501 ~ ERR-W1502)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1501 | 알라딘에서 상품 수량 선택을 실패했습니다 |
    | ERR-W1502 | 알라딘에서 구매 버튼 클릭을 실패했습니다 |
- Weverse Shop 쇼핑몰 에러 (ERR-W1601 ~ ERR-W1603)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1601 | Weverse Shop에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W1602 | Weverse Shop에서 구매 버튼 클릭을 실패했습니다 |
    | ERR-W1603 | Weverse Shop 주문서 작성 페이지로의 이동을 실패했습니다 |
- Makestar 쇼핑몰 에러 (ERR-W1701)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1701 | Makestar에서 상품 옵션 선택을 실패했습니다 |
- 올리브영 쇼핑몰 에러 (ERR-W1801 ~ ERR-W1812)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1801 | 올리브영에서 상품 옵션 창 열기를 실패했습니다 |
    | ERR-W1802 | 올리브영에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W1803 | 올리브영 상품 페이지로 이동하지 못했습니다 |
    | ERR-W1804 | 올리브영 상품 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W1805 | 올리브영 장바구니 담기 버튼을 클릭하지 못했습니다 |
    | ERR-W1806 | 올리브영 장바구니 담기 완료 메시지가 나타나지 않았습니다 |
    | ERR-W1807 | 올리브영 장바구니 페이지로 이동하지 못했습니다 |
    | ERR-W1808 | 올리브영 장바구니 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W1809 | 올리브영 상품을 장바구니에서 선택하지 못했습니다 |
    | ERR-W1810 | 올리브영 상품의 수량을 변경하지 못했습니다 |
    | ERR-W1811 | 올리브영 상품의 수량이 예상과 다릅니다 |
    | ERR-W1812 | 올리브영 오늘드림 활성화 취소 도중 문제가 발생했습니다 |
- 쿠팡 쇼핑몰 에러 (ERR-W1901 ~ ERR-W1903)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W1901 | 쿠팡 상품 옵션 선택 페이지로의 이동을 실패했습니다 |
    | ERR-W1902 | 쿠팡에서 상품 수량 선택을 실패했습니다 |
    | ERR-W1903 | 쿠팡 상품 수량 입력란이 활성화되지 않았습니다 |
- 다이소몰 쇼핑몰 에러 (ERR-W2001 ~ ERR-W2011)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W2001 | 다이소몰에서 박스 옵션 선택을 실패했습니다 |
    | ERR-W2002 | 다이소몰에서 박스 옵션이 렌더링되지 않았습니다 |
    | ERR-W2003 | 다이소몰에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W2004 | 다이소몰 상품 페이지로 이동하지 못했습니다 |
    | ERR-W2005 | 다이소몰 상품 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W2006 | 다이소몰 장바구니 담기 버튼을 클릭하지 못했습니다 |
    | ERR-W2007 | 다이소몰 장바구니 담기 완료 메시지가 나타나지 않았습니다 |
    | ERR-W2008 | 다이소몰 장바구니 페이지로 이동하지 못했습니다 |
    | ERR-W2009 | 다이소몰 장바구니 페이지가 로드되지 않았습니다 |
    | ERR-W2010 | 다이소몰 장바구니의 모든 상품 선택을 해제하지 못했습니다 |
    | ERR-W2011 | 다이소몰 장바구니에서 상품을 선택하지 못했습니다 |
- Yes24 쇼핑몰 에러 (ERR-W2101 ~ ERR-W2112)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W2101 | Yes24에서 상품 옵션 창 열기를 실패했습니다 |
    | ERR-W2102 | Yes24에서 상품 옵션 선택을 실패했습니다 |
    | ERR-W2103 | Yes24에서 상품 페이지로 이동하지 못했습니다 |
    | ERR-W2104 | Yes24 상품 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W2105 | Yes24 장바구니 담기 버튼을 클릭하지 못했습니다 |
    | ERR-W2106 | Yes24 장바구니 담기 완료 메시지가 나타나지 않았습니다 |
    | ERR-W2107 | Yes24 장바구니 페이지로 이동하지 못했습니다 |
    | ERR-W2108 | Yes24 장바구니 페이지가 정상적으로 로드되지 않았습니다 |
    | ERR-W2109 | Yes24 상품을 장바구니에서 선택하지 못했습니다 |
    | ERR-W2110 | Yes24 상품 수량 적용에 실패했습니다 |
    | ERR-W2111 | Yes24 상품 수량 변경하는데 실패했습니다 |
    | ERR-W2112 | Yes24 상품 수량이 예상과 다릅니다 |
- Witchform 쇼핑몰 에러 (ERR-W2201)
    
    
    | 코드 | 설명 |
    | --- | --- |
    | ERR-W2201 | Witchform에서 배송 방법을 선택하지 못했습니다. |

## 401 코드 - 인증 실패(키 만료)

## 404 코드 - 찾을 수 없는 자동화

| 코드 | 설명 |
| --- | --- |
| ERR-U1 | 자동화를 클라이언트에서 찾을 수 없습니다 |
| ERR-U2 | 클라이언트에서 해당 자동화가 비활성화 상태입니다 |

## 428 코드 - 사전 조건 실패 - 로그인 된 클라이언트가 하나도 없거나, 작업을 실행할 수 없는 상태

## 429 코드 - 너무 많은 요청 - 현재 연결된 모든 클라이언트가 실행 중인 상태

## 499 코드 - 작업 도중 클라이언트 연결 해제(강제 종료 등)

## 500 코드 - 서버 내부 오류(문의 필요)

| ERR-V | 클라이언트와 서버 간의 통신 규격에 오류가 있습니다 |
| --- | --- |
| ERR-C | 클라이언트 실행 도중 치명적인 문제가 발생했습니다 |

## 502 코드 - 클라이언트와 통신 불가

</aside>

---

# 📦 자동화 상세보기

## [Ktown4U](https://www.notion.so/Ktown4U-2ca9cd201d15817c9438e0d3d333d7cf?pvs=21)

## [네이버 스마트스토어](https://www.notion.so/2ca9cd201d15813d940bf0e281b0176c?pvs=21)

## [알라딘](https://www.notion.so/2ca9cd201d1581ffa337dca91ae013a4?pvs=21)

## [Makestar](https://www.notion.so/Makestar-2ca9cd201d15815dac9ff241062a56fe?pvs=21)

## [쿠팡](https://www.notion.so/2ca9cd201d158162bb80d471848e4f55?pvs=21)

## [Yes24](https://www.notion.so/Yes24-2e79cd201d1581eda1dad2d72c556187?pvs=21)

## [G마켓](https://www.notion.so/G-2ca9cd201d15812887c2f42e7c1a0398?pvs=21)

## [FANS](https://www.notion.so/FANS-2ca9cd201d1581e987b5d91a8f2a9e1a?pvs=21)

## [Weverse shop](https://www.notion.so/Weverse-shop-2ca9cd201d1581fe8961fce53121ff16?pvs=21)

## [올리브영](https://www.notion.so/2ca9cd201d158147ab9fe01cfbf18386?pvs=21)

## [다이소몰](https://www.notion.so/2ca9cd201d1581f4a2e5c2c49018bbea?pvs=21)

## [Witchform](https://www.notion.so/Witchform-3039cd201d158191a122cd3f6a282b2d?pvs=21)