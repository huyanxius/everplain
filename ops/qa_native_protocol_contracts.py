"""Offline native SDK request contracts; all calls use MockTransport and fake keys.

This is an isolated design harness, not an enabled Everplain native adapter.
"""

import asyncio
import inspect
import json

import httpx
import httpx2
import pytest
from anthropic import Omit
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider


class CanonicalGoogleThinkingTransport(httpx.AsyncBaseTransport):
    """Canonicalize only native thinking-level aliases before capture/transmission."""

    def __init__(self, inner):
        self.inner = inner

    async def handle_async_request(self, request):
        if request.method != 'POST' or not request.url.path.endswith((':generateContent', ':streamGenerateContent')):
            return await self.inner.handle_async_request(request)
        payload = json.loads(await request.aread())
        thinking = payload.get('generationConfig', {}).get('thinkingConfig', {})
        if 'thinking_level' in thinking:
            level = thinking.pop('thinking_level')
            if 'thinkingLevel' in thinking and thinking['thinkingLevel'] != level:
                raise ValueError('conflicting native Google thinking levels')
            thinking['thinkingLevel'] = level
            request = httpx.Request(
                request.method, request.url,
                headers={k: v for k, v in request.headers.items() if k != 'content-length'},
                content=json.dumps(payload), extensions=request.extensions,
            )
        return await self.inner.handle_async_request(request)

    async def aclose(self):
        await self.inner.aclose()


def native_usage_fact(raw, protocol, *, verified_google_cache_write=None):
    """Design prototype: raw counters, never SDK price-extraction fallback totals."""
    def counter(key):
        value = raw.get(key)
        if value is None:
            return None
        if type(value) is not int or value < 0:
            raise ValueError('invalid native token counter')
        return value
    if protocol == 'anthropic':
        ordinary, output = counter('input_tokens'), counter('output_tokens')
        read, written = counter('cache_read_input_tokens'), counter('cache_creation_input_tokens')
        inputs = ordinary + read + written if None not in (ordinary, read, written) else None
    elif protocol == 'google':
        inputs = counter('promptTokenCount')
        candidate, thoughts, total = (counter('candidatesTokenCount'),
                                     counter('thoughtsTokenCount'), counter('totalTokenCount'))
        output = candidate + thoughts if None not in (candidate, thoughts) else None
        if None not in (inputs, output, total) and inputs + output != total:
            raise ValueError('native Google usage contradicts total')
        read, written = counter('cachedContentTokenCount'), verified_google_cache_write
    else:
        raise ValueError('unsupported native receipt protocol')
    if written is not None and (type(written) is not int or written < 0):
        raise ValueError('invalid verified cache-write counter')
    if None not in (inputs, read, written) and read + written > inputs:
        raise ValueError('native cache subsets exceed input')
    return {'input_tokens': inputs, 'output_tokens': output,
            'cache_read_tokens': read, 'cache_write_tokens': written,
            'usage_known': None not in (inputs, output, read, written)}


@pytest.mark.parametrize('effort', ['low', 'medium', 'high', 'max'])
def test_documented_anthropic_native_levels_have_real_wire_controls(effort):
    calls = []

    def reply(request):
        calls.append((request.url.path, json.loads(request.content)))
        assert request.url.path == '/bypass/anthropic/v1/messages'
        return httpx2.Response(200, json={
            'id': 'synthetic-native', 'type': 'message', 'role': 'assistant',
            'model': 'claude-sonnet-5-5', 'content': [{'type': 'text', 'text': '323'}],
            'stop_reason': 'end_turn', 'stop_sequence': None,
            'usage': {'input_tokens': 20, 'output_tokens': 3,
                      'cache_creation_input_tokens': 2, 'cache_read_input_tokens': 4},
        })

    async def run():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(reply), trust_env=False) as http:
            model = AnthropicModel('claude-sonnet-5-5', provider=AnthropicProvider(
                api_key='synthetic', base_url='https://synthetic.invalid/bypass/anthropic',
                http_client=http,
            ), settings={'max_tokens': 4096, 'anthropic_thinking': {'type': 'adaptive'},
                         'anthropic_effort': effort})
            create = model.client.beta.messages.create
            accepted = set(inspect.signature(create).parameters)
            async def compatible_create(**kwargs):
                unsupported = {k: v for k, v in kwargs.items() if k not in accepted}
                if not all(isinstance(v, Omit) for v in unsupported.values()):
                    raise ValueError('unsupported explicitly supplied SDK parameter')
                return await create(**{k: v for k, v in kwargs.items() if k in accepted})
            model.client.beta.messages.create = compatible_create
            result = await Agent(model).run('17*19, reply only the integer.')
            assert result.output == '323'
            assert result.usage.input_tokens == 26
            assert result.usage.output_tokens == 3
            assert result.usage.cache_read_tokens == 4
            assert result.usage.cache_write_tokens == 2

    asyncio.run(run())
    assert len(calls) == 1
    payload = calls[0][1]
    assert payload['model'] == 'claude-sonnet-5-5'
    assert payload['thinking'] == {'type': 'adaptive'}
    assert payload['output_config'] == {'effort': effort}
    assert payload['max_tokens'] == 4096
    assert 'reasoning_effort' not in payload
    assert 'reasoning' not in payload


@pytest.mark.parametrize('level', ['minimal', 'low', 'medium', 'high'])
def test_google_native_levels_are_not_openai_enums(level):
    calls = []

    def reply(request):
        calls.append((request.url.path, json.loads(request.content)))
        assert request.url.path == '/v1beta/models/gemini-3.5-flash:generateContent'
        response = {
            'modelVersion': 'gemini-3.5-flash',
            'candidates': [{'content': {'role': 'model', 'parts': [{'text': '323'}]},
                            'finishReason': 'STOP'}],
            'usageMetadata': {'promptTokenCount': 20, 'candidatesTokenCount': 3,
                              'thoughtsTokenCount': 2, 'totalTokenCount': 25,
                              'cachedContentTokenCount': 4},
        }
        path, payload = calls[-1]
        calls[-1] = (path, payload, native_usage_fact(response['usageMetadata'], 'google'))
        return httpx.Response(200, json=response)

    async def run():
        async with httpx.AsyncClient(transport=CanonicalGoogleThinkingTransport(httpx.MockTransport(reply)), trust_env=False) as http:
            model = GoogleModel('gemini-3.5-flash', provider=GoogleProvider(
                api_key='synthetic', base_url='https://synthetic.invalid', http_client=http,
            ), settings={'max_tokens': 4096,
                         'google_thinking_config': {'thinking_level': level.upper()}})
            result = await Agent(model).run('17*19, reply only the integer.')
            assert result.output == '323'
            # Under this custom host the generic SDK price extractor yielded zero
            # totals in the isolated compatibility check. Never bill from that.
            assert calls[0][2] == {'input_tokens': 20, 'output_tokens': 5,
                                    'cache_read_tokens': 4, 'cache_write_tokens': None,
                                    'usage_known': False}

    asyncio.run(run())
    assert len(calls) == 1
    payload = calls[0][1]
    assert payload['generationConfig']['thinkingConfig'] == {'thinkingLevel': level.upper()}
    assert payload['generationConfig']['maxOutputTokens'] == 4096
    assert 'reasoning_effort' not in payload
    assert 'extra_body' not in payload


def test_native_anthropic_input_excludes_cache_and_is_normalized_once():
    assert native_usage_fact({'input_tokens': 20, 'output_tokens': 3,
                              'cache_read_input_tokens': 4,
                              'cache_creation_input_tokens': 2}, 'anthropic') == {
        'input_tokens': 26, 'output_tokens': 3, 'cache_read_tokens': 4,
        'cache_write_tokens': 2, 'usage_known': True,
    }


def test_missing_native_cache_receipts_remain_unknown():
    fact = native_usage_fact({'input_tokens': 20, 'output_tokens': 3}, 'anthropic')
    assert fact['input_tokens'] is None
    assert fact['cache_read_tokens'] is None
    assert fact['cache_write_tokens'] is None
    assert not fact['usage_known']


def test_google_thoughts_are_part_of_billed_output_and_cache_policy_is_explicit():
    raw = {'promptTokenCount': 20, 'candidatesTokenCount': 3, 'thoughtsTokenCount': 2,
           'totalTokenCount': 25, 'cachedContentTokenCount': 4}
    assert not native_usage_fact(raw, 'google')['usage_known']
    fact = native_usage_fact(raw, 'google', verified_google_cache_write=0)
    assert fact['input_tokens'] == 20
    assert fact['output_tokens'] == 5
    assert fact['cache_read_tokens'] == 4
    assert fact['usage_known']


@pytest.mark.parametrize('changed', [
    {'promptTokenCount': True}, {'thoughtsTokenCount': -1},
    {'cachedContentTokenCount': 30}, {'totalTokenCount': 21},
])
def test_google_invalid_or_contradictory_receipts_are_not_zero_cost(changed):
    raw = {'promptTokenCount': 20, 'candidatesTokenCount': 3, 'thoughtsTokenCount': 2,
           'totalTokenCount': 25, 'cachedContentTokenCount': 4, **changed}
    with pytest.raises(ValueError):
        native_usage_fact(raw, 'google', verified_google_cache_write=0)
