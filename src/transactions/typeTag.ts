// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * TypeTag system
 *
 * Full TypeTag parsing implementation including:
 * - All unsigned integer types (u8, u16, u32, u64, u128, u256)
 * - All signed integer types (i8, i16, i32, i64, i128, i256)
 * - Stack-based parseTypeTag parser with detailed error reporting
 */

import { Serializable, Serializer } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";

// ============================================================================
// TypeTag Variants (for BCS serialization)
// ============================================================================

export enum TypeTagVariants {
    Bool = 0,
    U8 = 1,
    U64 = 2,
    U128 = 3,
    Address = 4,
    Signer = 5,
    Vector = 6,
    Struct = 7,
    U16 = 8,
    U32 = 9,
    U256 = 10,
    Reference = 254,
    Generic = 253,
    I8 = 15,
    I16 = 16,
    I32 = 17,
    I64 = 18,
    I128 = 19,
    I256 = 20,
}

// ============================================================================
// Identifier (needed by StructTag)
// ============================================================================

class Identifier extends Serializable {
    constructor(public readonly identifier: string) {
        super();
    }

    serialize(serializer: Serializer): void {
        serializer.serializeStr(this.identifier);
    }
}

// ============================================================================
// TypeTag Base Class
// ============================================================================

export abstract class TypeTag extends Serializable {
    abstract toString(): string;

    isBool(): this is TypeTagBool {
        return this instanceof TypeTagBool;
    }

    isAddress(): this is TypeTagAddress {
        return this instanceof TypeTagAddress;
    }

    isU8(): this is TypeTagU8 {
        return this instanceof TypeTagU8;
    }

    isU16(): this is TypeTagU16 {
        return this instanceof TypeTagU16;
    }

    isU32(): this is TypeTagU32 {
        return this instanceof TypeTagU32;
    }

    isU64(): this is TypeTagU64 {
        return this instanceof TypeTagU64;
    }

    isU128(): this is TypeTagU128 {
        return this instanceof TypeTagU128;
    }

    isU256(): this is TypeTagU256 {
        return this instanceof TypeTagU256;
    }

    isVector(): this is TypeTagVector {
        return this instanceof TypeTagVector;
    }

    isStruct(): this is TypeTagStruct {
        return this instanceof TypeTagStruct;
    }

    isGeneric(): this is TypeTagGeneric {
        return this instanceof TypeTagGeneric;
    }

    isReference(): this is TypeTagReference {
        return this instanceof TypeTagReference;
    }

    isSigner(): this is TypeTagSigner {
        return this instanceof TypeTagSigner;
    }

    isI8(): this is TypeTagI8 {
        return this instanceof TypeTagI8;
    }

    isI16(): this is TypeTagI16 {
        return this instanceof TypeTagI16;
    }

    isI32(): this is TypeTagI32 {
        return this instanceof TypeTagI32;
    }

    isI64(): this is TypeTagI64 {
        return this instanceof TypeTagI64;
    }

    isI128(): this is TypeTagI128 {
        return this instanceof TypeTagI128;
    }

    isI256(): this is TypeTagI256 {
        return this instanceof TypeTagI256;
    }
}

// ============================================================================
// Concrete TypeTag classes
// ============================================================================

export class TypeTagBool extends TypeTag {
    toString(): string { return "bool"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Bool);
    }
}

export class TypeTagU8 extends TypeTag {
    toString(): string { return "u8"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.U8);
    }
}

export class TypeTagU16 extends TypeTag {
    toString(): string { return "u16"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.U16);
    }
}

export class TypeTagU32 extends TypeTag {
    toString(): string { return "u32"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.U32);
    }
}

export class TypeTagU64 extends TypeTag {
    toString(): string { return "u64"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.U64);
    }
}

export class TypeTagU128 extends TypeTag {
    toString(): string { return "u128"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.U128);
    }
}

export class TypeTagU256 extends TypeTag {
    toString(): string { return "u256"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.U256);
    }
}

export class TypeTagAddress extends TypeTag {
    toString(): string { return "address"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Address);
    }
}

export class TypeTagSigner extends TypeTag {
    toString(): string { return "signer"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Signer);
    }
}

export class TypeTagVector extends TypeTag {
    constructor(public readonly value: TypeTag) {
        super();
    }
    toString(): string { return `vector<${this.value.toString()}>`; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Vector);
        this.value.serialize(serializer);
    }
}

export class TypeTagGeneric extends TypeTag {
    constructor(public readonly value: number) {
        super();
        if (value < 0) throw new Error("Generic type parameter index cannot be negative");
    }
    toString(): string { return `T${this.value}`; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Generic);
        serializer.serializeU32(this.value);
    }
}

class TypeTagReference extends TypeTag {
    constructor(public readonly value: TypeTag) {
        super();
    }
    toString(): string { return `&${this.value.toString()}`; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Reference);
    }
}

// ============================================================================
// Signed integer TypeTag classes
// ============================================================================

export class TypeTagI8 extends TypeTag {
    toString(): string { return "i8"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.I8);
    }
}

export class TypeTagI16 extends TypeTag {
    toString(): string { return "i16"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.I16);
    }
}

export class TypeTagI32 extends TypeTag {
    toString(): string { return "i32"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.I32);
    }
}

export class TypeTagI64 extends TypeTag {
    toString(): string { return "i64"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.I64);
    }
}

export class TypeTagI128 extends TypeTag {
    toString(): string { return "i128"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.I128);
    }
}

export class TypeTagI256 extends TypeTag {
    toString(): string { return "i256"; }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.I256);
    }
}

// ============================================================================
// StructTag
// ============================================================================

export class StructTag extends Serializable {
    public readonly address: AccountAddress;
    public readonly moduleName: Identifier;
    public readonly name: Identifier;
    public readonly typeArgs: Array<TypeTag>;

    constructor(
        address: AccountAddress,
        moduleName: Identifier,
        name: Identifier,
        typeArgs: Array<TypeTag>,
    ) {
        super();
        this.address = address;
        this.moduleName = moduleName;
        this.name = name;
        this.typeArgs = typeArgs;
    }

    serialize(serializer: Serializer): void {
        serializer.serialize(this.address);
        serializer.serialize(this.moduleName);
        serializer.serialize(this.name);
        serializer.serializeVector(this.typeArgs);
    }
}

export class TypeTagStruct extends TypeTag {
    constructor(public readonly value: StructTag) {
        super();
    }

    toString(): string {
        let typePredicate = "";
        if (this.value.typeArgs.length > 0) {
            typePredicate = `<${this.value.typeArgs.map((typeArg) => typeArg.toString()).join(", ")}>`;
        }
        return `${this.value.address.toString()}::${this.value.moduleName.identifier}::${this.value.name.identifier}${typePredicate}`;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TypeTagVariants.Struct);
        this.value.serialize(serializer);
    }

    isString(): boolean {
        return (
            this.value.moduleName.identifier === "string" &&
            this.value.name.identifier === "String" &&
            this.value.address.equals(AccountAddress.ONE)
        );
    }

    isOption(): boolean {
        return (
            this.value.moduleName.identifier === "option" &&
            this.value.name.identifier === "Option" &&
            this.value.address.equals(AccountAddress.ONE)
        );
    }

    isObject(): boolean {
        return (
            this.value.moduleName.identifier === "object" &&
            this.value.name.identifier === "Object" &&
            this.value.address.equals(AccountAddress.ONE)
        );
    }
}

/**
 * Determines if the provided string is a valid Move identifier.
 */
function isValidIdentifier(str: string) {
    return !!str.match(/^[_a-zA-Z0-9]+$/);
}

/**
 * Determines if the provided character is a whitespace character.
 */
function isValidWhitespaceCharacter(char: string) {
    return !!char.match(/\s/);
}

/**
 * Determines if a given string represents a generic type (T0, T1, etc.).
 */
function isGeneric(str: string) {
    return !!str.match(/^T[0-9]+$/);
}

/**
 * Determines if the provided string is a reference type (starts with &).
 */
function isRef(str: string) {
    return !!str.match(/^&.+$/);
}

/**
 * Determines if the provided string represents a primitive type.
 */
function isPrimitive(str: string) {
    switch (str) {
        case "signer":
        case "address":
        case "bool":
        case "u8":
        case "u16":
        case "u32":
        case "u64":
        case "u128":
        case "u256":
        case "i8":
        case "i16":
        case "i32":
        case "i64":
        case "i128":
        case "i256":
            return true;
        default:
            return false;
    }
}

/**
 * Consumes all whitespace characters in a string starting from a specified position.
 */
function consumeWhitespace(tagStr: string, pos: number) {
    let i = pos;
    for (; i < tagStr.length; i += 1) {
        const innerChar = tagStr[i];
        if (!isValidWhitespaceCharacter(innerChar)) {
            break;
        }
    }
    return i;
}

type TypeTagState = {
    savedExpectedTypes: number;
    savedStr: string;
    savedTypes: Array<TypeTag>;
};

export enum TypeTagParserErrorType {
    InvalidTypeTag = "unknown type",
    UnexpectedGenericType = "unexpected generic type",
    UnexpectedTypeArgumentClose = "unexpected '>'",
    UnexpectedWhitespaceCharacter = "unexpected whitespace character",
    UnexpectedComma = "unexpected ','",
    TypeArgumentCountMismatch = "type argument count doesn't match expected amount",
    MissingTypeArgumentClose = "no matching '>' for '<'",
    MissingTypeArgument = "no type argument before ','",
    UnexpectedPrimitivetype_arguments = "primitive types not expected to have type arguments",
    UnexpectedVectorTypeArgumentCount = "vector type expected to have exactly one type argument",
    UnexpectedStructFormat = "unexpected struct format, must be of the form 0xaddress::module_name::struct_name",
    InvalidModuleNameCharacter = "module name must only contain alphanumeric or '_' characters",
    InvalidStructNameCharacter = "struct name must only contain alphanumeric or '_' characters",
    InvalidAddress = "struct address must be valid",
}

export class TypeTagParserError extends Error {
    constructor(typeTagStr: string, invalidReason: TypeTagParserErrorType) {
        super(`Failed to parse typeTag '${typeTagStr}', ${invalidReason}`);
    }
}

/**
 * Parses a type string into a structured representation of type tags.
 *
 * Supports:
 * 1. Simple types: u8, bool, address, etc.
 * 2. Standalone structs: 0x1::account::Account
 * 3. Nested structs: 0x1::coin::Coin<0x1234::coin::MyCoin>
 * 4. Multiple generics: 0x1::pair::Pair<u8, u16>
 * 5. Spacing in generics: 0x1::pair::Pair< u8 , u16>
 * 6. Nested generics of different depths
 * 7. ABI generic placeholders: T0, T1, T2
 */
export function parseTypeTag(typeStr: string, options?: { allowGenerics?: boolean }) {
    const allowGenerics = options?.allowGenerics ?? false;

    const saved: Array<TypeTagState> = [];
    // Internal types for a type tag e.g. '0x1::coin::Coin<innerTypes>'
    let innerTypes: Array<TypeTag> = [];
    // Current parsed types in a comma list e.g. 'u8, u8'
    let curTypes: Array<TypeTag> = [];
    // Current character index
    let cur: number = 0;
    // Current working string as a type or struct name
    let currentStr: string = "";
    let expectedTypes: number = 1;

    // Iterate through each character, and handle the border conditions
    while (cur < typeStr.length) {
        const char = typeStr[cur];

        if (char === "<") {
            // Start of a type argument, push current state onto a stack
            saved.push({
                savedExpectedTypes: expectedTypes,
                savedStr: currentStr,
                savedTypes: curTypes,
            });

            // Clear current state
            currentStr = "";
            curTypes = [];
            expectedTypes = 1;
        } else if (char === ">") {
            // Process last type, if there is no type string, then don't parse it
            if (currentStr !== "") {
                const newType = parseTypeTagInner(currentStr, innerTypes, allowGenerics);
                curTypes.push(newType);
            }

            // Pop off stack outer type, if there's nothing left, there were too many '>'
            const savedPop = saved.pop();
            if (savedPop === undefined) {
                throw new TypeTagParserError(typeStr, TypeTagParserErrorType.UnexpectedTypeArgumentClose);
            }

            // If the expected types don't match the number of commas, then we also fail
            if (expectedTypes !== curTypes.length) {
                throw new TypeTagParserError(typeStr, TypeTagParserErrorType.TypeArgumentCountMismatch);
            }

            // Add in the new created type, shifting the current types to the inner types
            const { savedStr, savedTypes, savedExpectedTypes } = savedPop;
            innerTypes = curTypes;
            curTypes = savedTypes;
            currentStr = savedStr;
            expectedTypes = savedExpectedTypes;
        } else if (char === ",") {
            // Comma means we need to start parsing a new tag, push the previous one to the curTypes

            // No top level commas (not in a type <> are allowed)
            if (saved.length === 0) {
                throw new TypeTagParserError(typeStr, TypeTagParserErrorType.UnexpectedComma);
            }
            // If there was no actual value before the comma, then it's missing a type argument
            if (currentStr.length === 0) {
                throw new TypeTagParserError(typeStr, TypeTagParserErrorType.MissingTypeArgument);
            }

            // Process characters before as a type
            const newType = parseTypeTagInner(currentStr, innerTypes, allowGenerics);

            // parse type tag and push it on the types
            innerTypes = [];
            curTypes.push(newType);
            currentStr = "";
            expectedTypes += 1;
        } else if (isValidWhitespaceCharacter(char)) {
            // This means we should save what we have and everything else should skip until the next
            let parsedTypeTag = false;
            if (currentStr.length !== 0) {
                const newType = parseTypeTagInner(currentStr, innerTypes, allowGenerics);

                // parse type tag and push it on the types
                innerTypes = [];
                curTypes.push(newType);
                currentStr = "";
                parsedTypeTag = true;
            }

            // Skip ahead on any more whitespace
            cur = consumeWhitespace(typeStr, cur);

            // The next space MUST be a comma, or a closing > if there was something parsed before
            // e.g. `u8 u8` is invalid but `u8, u8` is valid
            const nextChar = typeStr[cur];
            if (cur < typeStr.length && parsedTypeTag && nextChar !== "," && nextChar !== ">") {
                throw new TypeTagParserError(typeStr, TypeTagParserErrorType.UnexpectedWhitespaceCharacter);
            }

            continue;
        } else {
            // Any other characters just append to the current string
            currentStr += char;
        }

        cur += 1;
    }

    // This prevents a missing '>' on type arguments
    if (saved.length > 0) {
        throw new TypeTagParserError(typeStr, TypeTagParserErrorType.MissingTypeArgumentClose);
    }

    // This prevents 'u8, u8' as an input
    switch (curTypes.length) {
        case 0:
            return parseTypeTagInner(currentStr, innerTypes, allowGenerics);
        case 1:
            if (currentStr === "") {
                return curTypes[0];
            }
            throw new TypeTagParserError(typeStr, TypeTagParserErrorType.UnexpectedComma);
        default:
            throw new TypeTagParserError(typeStr, TypeTagParserErrorType.UnexpectedWhitespaceCharacter);
    }
}

/**
 * Parses a type tag with internal types associated.
 */
function parseTypeTagInner(str: string, types: Array<TypeTag>, allowGenerics: boolean): TypeTag {
    const trimmedStr = str.trim();
    const lowerCaseTrimmed = trimmedStr.toLowerCase();
    if (isPrimitive(lowerCaseTrimmed)) {
        if (types.length > 0) {
            throw new TypeTagParserError(str, TypeTagParserErrorType.UnexpectedPrimitivetype_arguments);
        }
    }

    switch (trimmedStr.toLowerCase()) {
        case "signer":
            return new TypeTagSigner();
        case "bool":
            return new TypeTagBool();
        case "address":
            return new TypeTagAddress();
        case "u8":
            return new TypeTagU8();
        case "u16":
            return new TypeTagU16();
        case "u32":
            return new TypeTagU32();
        case "u64":
            return new TypeTagU64();
        case "u128":
            return new TypeTagU128();
        case "u256":
            return new TypeTagU256();
        case "i8":
            return new TypeTagI8();
        case "i16":
            return new TypeTagI16();
        case "i32":
            return new TypeTagI32();
        case "i64":
            return new TypeTagI64();
        case "i128":
            return new TypeTagI128();
        case "i256":
            return new TypeTagI256();
        case "vector":
            if (types.length !== 1) {
                throw new TypeTagParserError(str, TypeTagParserErrorType.UnexpectedVectorTypeArgumentCount);
            }
            return new TypeTagVector(types[0]);
        default:
            // Reference will have to handle the inner type
            if (isRef(trimmedStr)) {
                const actualType = trimmedStr.substring(1);
                return new TypeTagReference(parseTypeTagInner(actualType, types, allowGenerics));
            }

            // Generics are always expected to be T0 or T1
            if (isGeneric(trimmedStr)) {
                if (allowGenerics) {
                    return new TypeTagGeneric(Number(trimmedStr.split("T")[1]));
                }
                throw new TypeTagParserError(str, TypeTagParserErrorType.UnexpectedGenericType);
            }

            // If the value doesn't contain a colon, then we'll assume it isn't trying to be a struct
            if (!trimmedStr.match(/:/)) {
                throw new TypeTagParserError(str, TypeTagParserErrorType.InvalidTypeTag);
            }

            // Parse for a struct tag
            const structParts = trimmedStr.split("::");
            if (structParts.length !== 3) {
                throw new TypeTagParserError(str, TypeTagParserErrorType.UnexpectedStructFormat);
            }

            // Validate struct address
            let address: AccountAddress;
            try {
                address = AccountAddress.fromString(structParts[0]);
            } catch (error: any) {
                throw new TypeTagParserError(str, TypeTagParserErrorType.InvalidAddress);
            }

            // Validate identifier characters
            if (!isValidIdentifier(structParts[1])) {
                throw new TypeTagParserError(str, TypeTagParserErrorType.InvalidModuleNameCharacter);
            }
            if (!isValidIdentifier(structParts[2])) {
                throw new TypeTagParserError(str, TypeTagParserErrorType.InvalidStructNameCharacter);
            }

            return new TypeTagStruct(
                new StructTag(address, new Identifier(structParts[1]), new Identifier(structParts[2]), types),
            );
    }
}
